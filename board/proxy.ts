import path from "node:path";

function isoNow(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureTrailingSlash(origin: string): string {
  return origin.endsWith("/") ? origin : `${origin}/`;
}

function normalizePath(pathname: string): string {
  return pathname.startsWith("/") ? pathname.slice(1) : pathname;
}

function isFilesystemPath(value: string): boolean {
  if (/^[A-Za-z]:[\\/]/u.test(value)) {
    return true;
  }

  if (!value.startsWith("/")) {
    return false;
  }

  return /^(\/Users\/|\/var\/|\/tmp\/|\/opt\/|\/home\/|\/root\/|\/etc\/)/u.test(value);
}

function sanitizeRefName(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (!isFilesystemPath(value) && !value.includes("/") && !value.includes("\\")) {
    return value;
  }

  const normalized = value.replace(/\\/gu, "/");
  const name = path.posix.basename(normalized);
  return name || null;
}

function sanitizeValue(value: unknown, key: string | null = null): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, key));
  }

  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      next[entryKey] = sanitizeValue(entryValue, entryKey);
    }
    return next;
  }

  if (typeof value !== "string") {
    return value;
  }

  if (key === "state_root" || key?.endsWith("_path")) {
    return null;
  }

  if (key?.endsWith("_ref") || key?.endsWith("_refs")) {
    return sanitizeRefName(value);
  }

  if (isFilesystemPath(value)) {
    return null;
  }

  return value;
}

function ownerRefFromSessionLike(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const owner = value.owner;
  if (!isRecord(owner)) {
    return null;
  }

  return typeof owner.ref === "string" ? owner.ref : null;
}

function asArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} response to be an array.`);
  }

  return value.filter(isRecord);
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Expected ${label} response to be an object.`);
  }

  return value;
}

export interface BoardProxyConfig {
  sidecarOrigin: string;
}

export interface BoardHealthView {
  status: "ok";
  server_role: "viewer_board";
  now: string;
  owner_ref: string;
  session_count: number;
  focus_count: number;
  ui: {
    access_mode: "token_board";
    read_only: true;
    session_console_url: string;
  };
}

export class BoardProxy {
  readonly sidecarOrigin: string;

  constructor(config: BoardProxyConfig) {
    this.sidecarOrigin = ensureTrailingSlash(config.sidecarOrigin);
  }

  async listSessions(ownerRef: string): Promise<Record<string, unknown>[]> {
    const sessions = asArray(await this.fetchJson("/sessions"), "sessions");
    return sessions
      .filter((session) => ownerRefFromSessionLike(session) === ownerRef)
      .map((session) => sanitizeValue(session) as Record<string, unknown>);
  }

  async getSessionDetail(
    ownerRef: string,
    sessionId: string
  ): Promise<Record<string, unknown> | null> {
    const detail = await this.fetchJson(`/sessions/${encodeURIComponent(sessionId)}`, {
      allowNotFound: true
    });

    if (detail === null) {
      return null;
    }

    const object = asObject(detail, "session detail");
    const session = asObject(object.session, "session detail.session");

    if (ownerRefFromSessionLike(session) !== ownerRef) {
      return null;
    }

    return sanitizeValue(object) as Record<string, unknown>;
  }

  async getSessionTimeline(
    ownerRef: string,
    sessionId: string
  ): Promise<Record<string, unknown> | null> {
    const detail = await this.getSessionDetail(ownerRef, sessionId);
    if (!detail) {
      return null;
    }

    const timeline = await this.fetchJson(`/sessions/${encodeURIComponent(sessionId)}/timeline`, {
      allowNotFound: true
    });

    if (timeline === null) {
      return null;
    }

    return sanitizeValue(asObject(timeline, "session timeline")) as Record<string, unknown>;
  }

  async getFocus(ownerRef: string): Promise<Record<string, unknown>[]> {
    const [sessions, focus] = await Promise.all([
      this.listSessions(ownerRef),
      this.fetchJson("/focus")
    ]);

    const ownedSessionIds = new Set(
      sessions
        .map((session) => session.session_id)
        .filter((sessionId): sessionId is string => typeof sessionId === "string")
    );

    return asArray(focus, "focus")
      .filter((item) => typeof item.session_id === "string" && ownedSessionIds.has(item.session_id))
      .map((item) => sanitizeValue(item) as Record<string, unknown>);
  }

  async getDigest(ownerRef: string): Promise<Record<string, unknown>> {
    const [sessions, focus] = await Promise.all([
      this.listSessions(ownerRef),
      this.getFocus(ownerRef)
    ]);

    const lines = buildDigestLines(sessions, focus);
    return {
      owner_ref: ownerRef,
      generated_at: isoNow(),
      session_count: sessions.length,
      focus_count: focus.length,
      digest: lines.join("\n")
    };
  }

  async getHealth(ownerRef: string, boardUrl: string): Promise<BoardHealthView> {
    const [sessions, focus] = await Promise.all([
      this.listSessions(ownerRef),
      this.getFocus(ownerRef)
    ]);

    return {
      status: "ok",
      server_role: "viewer_board",
      now: isoNow(),
      owner_ref: ownerRef,
      session_count: sessions.length,
      focus_count: focus.length,
      ui: {
        access_mode: "token_board",
        read_only: true,
        session_console_url: boardUrl
      }
    };
  }

  private async fetchJson(
    pathname: string,
    options: {
      allowNotFound?: boolean;
    } = {}
  ): Promise<unknown> {
    const url = new URL(normalizePath(pathname), this.sidecarOrigin);
    const response = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });

    if (options.allowNotFound && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Board proxy fetch failed: GET ${url.toString()} -> ${response.status}`);
    }

    return response.json();
  }
}

function buildDigestLines(
  sessions: Record<string, unknown>[],
  focus: Record<string, unknown>[]
): string[] {
  const lines = [
    "# Viewer Board Digest",
    "",
    `- Sessions: ${sessions.length}`,
    `- Focus items: ${focus.length}`
  ];

  if (focus.length > 0) {
    lines.push("", "## Needs Attention");
    for (const item of focus.slice(0, 5)) {
      lines.push(
        `- ${stringValue(item.session_id, "unknown session")}: ${stringValue(
          item.category,
          "attention"
        )} -> ${stringValue(item.recommended_next_step, "review in chat")}`
      );
    }
  }

  if (sessions.length > 0) {
    lines.push("", "## Sessions");
    for (const session of sessions.slice(0, 10)) {
      lines.push(
        `- ${stringValue(session.title, "Untitled session")} (${stringValue(
          session.status,
          "unknown"
        )})`
      );
    }
  } else {
    lines.push("", "No sessions owned by this board token yet.");
  }

  return lines;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

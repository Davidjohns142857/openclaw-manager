import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BoardSnapshotRecord {
  snapshot_at: string;
  sessions: Record<string, unknown>[];
  focus: Record<string, unknown>[];
  session_details: Record<string, Record<string, unknown>>;
  session_timelines: Record<string, Record<string, unknown>>;
}

export interface BoardSnapshotMeta {
  token: string;
  owner_ref: string;
  last_received_at: string;
  last_snapshot_at: string;
  push_count: number;
  session_count: number;
  focus_count: number;
  last_payload_bytes: number;
}

function isoNow(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function sanitizeRecordMap(value: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => isRecord(entry))
      .map(([key, entry]) => [key, sanitizeValue(entry) as Record<string, unknown>])
  );
}

function normalizeSnapshot(value: unknown): BoardSnapshotRecord {
  if (!isRecord(value)) {
    throw new Error("Board snapshot payload must be a JSON object.");
  }

  return {
    snapshot_at: typeof value.snapshot_at === "string" ? value.snapshot_at : isoNow(),
    sessions: Array.isArray(value.sessions)
      ? value.sessions
          .filter((entry): entry is Record<string, unknown> => isRecord(entry))
          .map((entry) => sanitizeValue(entry) as Record<string, unknown>)
      : [],
    focus: Array.isArray(value.focus)
      ? value.focus
          .filter((entry): entry is Record<string, unknown> => isRecord(entry))
          .map((entry) => sanitizeValue(entry) as Record<string, unknown>)
      : [],
    session_details: sanitizeRecordMap(value.session_details),
    session_timelines: sanitizeRecordMap(value.session_timelines)
  };
}

function tokenDirectoryName(token: string): string {
  return token.slice(0, 16).replace(/[^A-Za-z0-9_-]/gu, "_") || "default";
}

async function writeJsonAtomically(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function buildBoardDigest(
  snapshot: BoardSnapshotRecord | null,
  ownerRef: string
): string {
  if (!snapshot) {
    return [
      "# Viewer Board Digest",
      "",
      `- Owner: ${ownerRef}`,
      "- No snapshot has arrived yet.",
      "- Keep chatting in OpenClaw and use `/adopt` when a task should become durable."
    ].join("\n");
  }

  const focusLines = snapshot.focus
    .slice(0, 5)
    .map((item) => {
      const title =
        typeof item.session_title === "string"
          ? item.session_title
          : typeof item.session_id === "string"
            ? item.session_id
            : "unknown_session";
      const category = typeof item.category === "string" ? item.category : "attention";
      const nextStep =
        typeof item.recommended_next_step === "string"
          ? item.recommended_next_step
          : "Open the session in chat.";
      return `- ${title}: ${category} -> ${nextStep}`;
    });

  return [
    "# Viewer Board Digest",
    "",
    `- Owner: ${ownerRef}`,
    `- Snapshot at: ${snapshot.snapshot_at}`,
    `- Sessions: ${snapshot.sessions.length}`,
    `- Focus items: ${snapshot.focus.length}`,
    "",
    focusLines.length > 0 ? "## Focus" : "## Focus",
    ...(focusLines.length > 0 ? focusLines : ["- No urgent focus items right now."])
  ].join("\n");
}

export class BoardSnapshotStore {
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async writeLatest(
    token: string,
    ownerRef: string,
    rawSnapshot: unknown
  ): Promise<{ snapshot: BoardSnapshotRecord; meta: BoardSnapshotMeta }> {
    const snapshot = normalizeSnapshot(rawSnapshot);
    const existingMeta = await this.readMeta(token);
    const nextMeta: BoardSnapshotMeta = {
      token,
      owner_ref: ownerRef,
      last_received_at: isoNow(),
      last_snapshot_at: snapshot.snapshot_at,
      push_count: (existingMeta?.push_count ?? 0) + 1,
      session_count: snapshot.sessions.length,
      focus_count: snapshot.focus.length,
      last_payload_bytes: Buffer.byteLength(JSON.stringify(snapshot), "utf8")
    };

    await writeJsonAtomically(this.latestSnapshotPath(token), snapshot);
    await writeJsonAtomically(this.metaPath(token), nextMeta);

    return {
      snapshot,
      meta: nextMeta
    };
  }

  async readLatest(token: string): Promise<BoardSnapshotRecord | null> {
    return readJsonFile<BoardSnapshotRecord>(this.latestSnapshotPath(token));
  }

  async readMeta(token: string): Promise<BoardSnapshotMeta | null> {
    return readJsonFile<BoardSnapshotMeta>(this.metaPath(token));
  }

  private tokenDir(token: string): string {
    return path.join(this.dataDir, "snapshots", tokenDirectoryName(token));
  }

  private latestSnapshotPath(token: string): string {
    return path.join(this.tokenDir(token), "latest.json");
  }

  private metaPath(token: string): string {
    return path.join(this.tokenDir(token), "meta.json");
  }
}

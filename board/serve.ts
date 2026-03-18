import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  findActiveTokenForOwner,
  RegistrationRateLimiter,
  validateRegistrationRequest
} from "./registration.ts";
import {
  buildBoardDigest,
  BoardSnapshotStore,
  isSnapshotMetaOlderThan
} from "./snapshot-store.ts";
import { FileTokenStore } from "./token-store.ts";
import { serveBoardUiFile } from "../src/api/ui-assets.ts";

interface BoardConfig {
  port: number;
  bindHost: string;
  dataDir: string;
  adminSecret: string | null;
  staleAfterMs: number;
  staleTokenAfterMs: number;
  revokeTokenAfterMs: number;
  publicOrigin: string | null;
}

interface JsonBody {
  [key: string]: unknown;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = resolveConfig();
const tokenStore = new FileTokenStore(config.dataDir);
const snapshotStore = new BoardSnapshotStore(config.dataDir);
const registrationRateLimiter = new RegistrationRateLimiter();

function resolveConfig(env: NodeJS.ProcessEnv = process.env): BoardConfig {
  return {
    port: parseInteger(env.BOARD_PORT, 18991),
    bindHost: env.BOARD_BIND_HOST?.trim() || "0.0.0.0",
    dataDir: env.BOARD_DATA_DIR?.trim() || "/var/lib/openclaw-board",
    adminSecret: env.BOARD_ADMIN_SECRET?.trim() || null,
    staleAfterMs: parseInteger(env.BOARD_STALE_AFTER_MS, 45000),
    staleTokenAfterMs: parseInteger(env.BOARD_STALE_TOKEN_AFTER_MS, 30 * 24 * 60 * 60 * 1000),
    revokeTokenAfterMs: parseInteger(env.BOARD_REVOKE_TOKEN_AFTER_MS, 90 * 24 * 60 * 60 * 1000),
    publicOrigin: env.BOARD_PUBLIC_ORIGIN?.trim() || null
  };
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function jsonResponse(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function htmlResponse(response: ServerResponse, statusCode: number, html: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8"
  });
  response.end(html);
}

function redirectResponse(response: ServerResponse, location: string): void {
  response.writeHead(302, {
    location
  });
  response.end();
}

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
}

function buildRequestOrigin(request: IncomingMessage): string {
  if (config.publicOrigin) {
    return config.publicOrigin;
  }

  const protoHeader = request.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  const host = request.headers.host ?? `127.0.0.1:${config.port}`;
  const protocol = forwardedProto?.trim() || "http";
  return `${protocol}://${host}`;
}

function buildBoardUrl(request: IncomingMessage, token: string): string {
  return new URL(`/board/${encodeURIComponent(token)}/`, buildRequestOrigin(request)).toString();
}

async function readJsonBody(request: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object body.");
  }

  return parsed as JsonBody;
}

function requireAdmin(request: IncomingMessage, response: ServerResponse): boolean {
  if (!config.adminSecret) {
    jsonResponse(response, 503, {
      error: "BOARD_ADMIN_SECRET is not configured."
    });
    return false;
  }

  const authorization = request.headers.authorization ?? "";
  if (authorization !== `Bearer ${config.adminSecret}`) {
    jsonResponse(response, 401, {
      error: "Unauthorized"
    });
    return false;
  }

  return true;
}

function invalidTokenPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Viewer Board</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0e1117; color: #e6edf3; font-family: sans-serif; }
      .card { max-width: 520px; padding: 28px; border: 1px solid #30363d; border-radius: 12px; background: #161b22; }
      h1 { margin: 0 0 12px; font-size: 20px; }
      p { margin: 0; color: #8b949e; line-height: 1.6; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Viewer board unavailable</h1>
      <p>This board link is invalid, expired, or revoked. Ask the board owner for a fresh link.</p>
    </div>
  </body>
</html>`;
}

function notFound(response: ServerResponse): void {
  jsonResponse(response, 404, {
    error: "Not found"
  });
}

function tokenFromBoardPath(pathname: string): { token: string; mountPath: string } | null {
  const parts = splitPath(pathname);
  if (parts[0] !== "board" || parts.length < 2) {
    return null;
  }

  const token = parts[1] ?? "";
  return {
    token,
    mountPath: `/board/${encodeURIComponent(token)}`
  };
}

function tokenFromApiPath(pathname: string): { token: string; rest: string[] } | null {
  const parts = splitPath(pathname);
  if (parts[0] !== "board-api" || parts.length < 2) {
    return null;
  }

  return {
    token: parts[1] ?? "",
    rest: parts.slice(2)
  };
}

function tokenFromSyncPath(pathname: string): string | null {
  const parts = splitPath(pathname);
  return parts.length === 2 && parts[0] === "board-sync" ? parts[1] ?? null : null;
}

function tokenFromAdminPath(pathname: string): { token: string | null; action: string | null } | null {
  const parts = splitPath(pathname);
  if (parts[0] !== "admin" || parts[1] !== "tokens") {
    return null;
  }

  return {
    token: parts.length >= 3 ? parts[2] ?? null : null,
    action: parts.length >= 4 ? parts[3] ?? null : null
  };
}

function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

const server = createServer((request, response) => {
  void route(request, response);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    if (pathname === "/register") {
      await handleRegistrationRoute(request, response);
      return;
    }

    const adminPath = tokenFromAdminPath(pathname);
    if (adminPath) {
      await handleAdminRoute(request, response, adminPath);
      return;
    }

    const boardSyncToken = tokenFromSyncPath(pathname);
    if (boardSyncToken) {
      await handleBoardSyncRoute(request, response, boardSyncToken);
      return;
    }

    const boardApiPath = tokenFromApiPath(pathname);
    if (boardApiPath) {
      await handleBoardApiRoute(request, response, boardApiPath.token, boardApiPath.rest);
      return;
    }

    const boardUiPath = tokenFromBoardPath(pathname);
    if (boardUiPath) {
      await handleBoardUiRoute(request, response, pathname, boardUiPath.token, boardUiPath.mountPath);
      return;
    }

    if (pathname === "/health" && request.method === "GET") {
      jsonResponse(response, 200, {
        status: "ok",
        server_role: "viewer_board",
        storage_mode: "snapshot",
        now: new Date().toISOString()
      });
      return;
    }

    notFound(response);
  } catch (error) {
    jsonResponse(response, 500, {
      error: error instanceof Error ? error.message : "Unknown board server error"
    });
  }
}

async function handleBoardUiRoute(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  token: string,
  mountPath: string
): Promise<void> {
  if (request.method !== "GET") {
    jsonResponse(response, 405, { error: "Board UI is read-only." });
    return;
  }

  const resolved = await tokenStore.resolve(token);
  if (!resolved) {
    htmlResponse(response, 403, invalidTokenPage());
    return;
  }

  if (pathname === mountPath) {
    redirectResponse(response, `${mountPath}/`);
    return;
  }

  await serveBoardUiFile(repoRoot, response, pathname, mountPath);
}

async function handleRegistrationRoute(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { status: "error", error: "method_not_allowed" });
    return;
  }

  const ip = clientIp(request);
  if (!registrationRateLimiter.tryConsume(ip)) {
    jsonResponse(response, 429, { status: "error", error: "ip_rate_limit_exceeded" });
    return;
  }

  let body: JsonBody;
  try {
    body = await readJsonBody(request);
  } catch {
    jsonResponse(response, 400, { status: "error", error: "invalid_json" });
    return;
  }

  const ownerRef = typeof body.owner_ref === "string" ? body.owner_ref.trim() : "";
  const validationError = validateRegistrationRequest(ownerRef, body.install_proof);
  if (validationError) {
    jsonResponse(response, 400, { status: "error", error: validationError });
    return;
  }

  const existing = await findActiveTokenForOwner(tokenStore, ownerRef);
  if (existing) {
    const existingMeta = await snapshotStore.readMeta(existing.token);
    if (isSnapshotMetaOlderThan(existingMeta, config.revokeTokenAfterMs)) {
      await tokenStore.revoke(existing.token);
    } else {
      jsonResponse(response, 200, {
        status: "existing",
        token: existing.token,
        board_url: buildBoardUrl(request, existing.token),
        push_url: new URL(`/board-sync/${encodeURIComponent(existing.token)}`, buildRequestOrigin(request)).toString(),
        owner_ref: existing.owner_ref,
        created_at: existing.created_at,
        stale: isSnapshotMetaOlderThan(existingMeta, config.staleTokenAfterMs)
      });
      return;
    }
  }

  const label =
    typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim()
      : "auto-registered";
  const token = await tokenStore.create(ownerRef, label, null);

  jsonResponse(response, 200, {
    status: "created",
    token: token.token,
    board_url: buildBoardUrl(request, token.token),
    push_url: new URL(`/board-sync/${encodeURIComponent(token.token)}`, buildRequestOrigin(request)).toString(),
    owner_ref: token.owner_ref,
    created_at: token.created_at
  });
}

async function buildTokenView(request: IncomingMessage, token: Awaited<ReturnType<typeof tokenStore.list>>[number]) {
  const meta = await snapshotStore.readMeta(token.token);
  return {
    ...token,
    board_url: buildBoardUrl(request, token.token),
    stale: isSnapshotMetaOlderThan(meta, config.staleTokenAfterMs),
    auto_revoked_candidate: isSnapshotMetaOlderThan(meta, config.revokeTokenAfterMs)
  };
}

async function handleBoardSyncRoute(
  request: IncomingMessage,
  response: ServerResponse,
  token: string
): Promise<void> {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { error: "Board sync only accepts POST." });
    return;
  }

  const resolved = await tokenStore.resolve(token);
  if (!resolved) {
    jsonResponse(response, 403, { error: "Invalid board token." });
    return;
  }

  const headerToken = request.headers["x-board-token"];
  const suppliedHeaderToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  if (suppliedHeaderToken && suppliedHeaderToken !== token) {
    jsonResponse(response, 401, { error: "Board token header does not match path token." });
    return;
  }

  const body = await readJsonBody(request);
  const { snapshot, meta } = await snapshotStore.writeLatest(token, resolved.owner_ref, body);

  jsonResponse(response, 202, {
    status: "accepted",
    token,
    owner_ref: resolved.owner_ref,
    board_url: buildBoardUrl(request, token),
    snapshot_at: snapshot.snapshot_at,
    session_count: snapshot.sessions.length,
    focus_count: snapshot.focus.length,
    push_count: meta.push_count
  });
}

async function handleBoardApiRoute(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  rest: string[]
): Promise<void> {
  if (request.method !== "GET") {
    jsonResponse(response, 405, { error: "Board API is read-only." });
    return;
  }

  const resolved = await tokenStore.resolve(token);
  if (!resolved) {
    jsonResponse(response, 403, { error: "Invalid board token." });
    return;
  }

  const ownerRef = resolved.owner_ref;
  const boardUrl = buildBoardUrl(request, token);
  const [snapshot, meta] = await Promise.all([
    snapshotStore.readLatest(token),
    snapshotStore.readMeta(token)
  ]);

  if (rest.length === 1 && rest[0] === "sessions") {
    jsonResponse(response, 200, snapshot?.sessions ?? []);
    return;
  }

  if (rest.length === 2 && rest[0] === "sessions") {
    const detail = snapshot?.session_details[rest[1] ?? ""] ?? null;
    if (!detail) {
      notFound(response);
      return;
    }

    jsonResponse(response, 200, detail);
    return;
  }

  if (rest.length === 3 && rest[0] === "sessions" && rest[2] === "timeline") {
    const timeline = snapshot?.session_timelines[rest[1] ?? ""] ?? null;
    if (!timeline) {
      notFound(response);
      return;
    }

    jsonResponse(response, 200, timeline);
    return;
  }

  if (rest.length === 1 && rest[0] === "focus") {
    jsonResponse(response, 200, snapshot?.focus ?? []);
    return;
  }

  if (rest.length === 1 && rest[0] === "digest") {
    jsonResponse(response, 200, {
      owner_ref: ownerRef,
      generated_at: new Date().toISOString(),
      session_count: snapshot?.sessions.length ?? 0,
      focus_count: snapshot?.focus.length ?? 0,
      snapshot_at: snapshot?.snapshot_at ?? null,
      digest: buildBoardDigest(snapshot, ownerRef)
    });
    return;
  }

  if (rest.length === 1 && rest[0] === "health") {
    const lastReceivedAt = meta?.last_received_at ?? null;
    const online =
      lastReceivedAt !== null &&
      Number.isFinite(Date.parse(lastReceivedAt)) &&
      Date.now() - Date.parse(lastReceivedAt) <= config.staleAfterMs;

    jsonResponse(response, 200, {
      status: "ok",
      server_role: "viewer_board",
      now: new Date().toISOString(),
      owner_ref: ownerRef,
      session_count: snapshot?.sessions.length ?? 0,
      focus_count: snapshot?.focus.length ?? 0,
      snapshot_at: meta?.last_snapshot_at ?? snapshot?.snapshot_at ?? null,
      last_received_at: lastReceivedAt,
      online,
      ui: {
        access_mode: "token_board",
        read_only: true,
        session_console_url: boardUrl
      }
    });
    return;
  }

  notFound(response);
}

async function handleAdminRoute(
  request: IncomingMessage,
  response: ServerResponse,
  route: { token: string | null; action: string | null }
): Promise<void> {
  if (!requireAdmin(request, response)) {
    return;
  }

  if (request.method === "GET" && route.token === null) {
    const tokens = await tokenStore.list();
    jsonResponse(response, 200, {
      tokens: await Promise.all(tokens.map((token) => buildTokenView(request, token)))
    });
    return;
  }

  if (request.method === "POST" && route.token === null) {
    const body = await readJsonBody(request);
    const ownerRef = typeof body.owner_ref === "string" ? body.owner_ref : "";
    const label = typeof body.label === "string" ? body.label : "default board";
    const expiresAt = typeof body.expires_at === "string" ? body.expires_at : null;

    if (!ownerRef.trim()) {
      jsonResponse(response, 400, {
        error: "owner_ref is required."
      });
      return;
    }

    const token = await tokenStore.create(ownerRef, label, expiresAt);

    jsonResponse(response, 201, {
      token: token.token,
      board_url: buildBoardUrl(request, token.token),
      owner_ref: token.owner_ref,
      created_at: token.created_at,
      expires_at: token.expires_at,
      label: token.label
    });
    return;
  }

  if (request.method === "POST" && route.token && route.action === "revoke") {
    const revoked = await tokenStore.revoke(route.token);
    jsonResponse(response, revoked ? 200 : 404, {
      token: route.token,
      revoked
    });
    return;
  }

  if (request.method === "POST" && route.token && route.action === "rotate") {
    const rotated = await tokenStore.rotate(route.token);
    if (!rotated) {
      notFound(response);
      return;
    }

    jsonResponse(response, 200, {
      previous_token: route.token,
      token: rotated.token,
      board_url: buildBoardUrl(request, rotated.token),
      owner_ref: rotated.owner_ref,
      created_at: rotated.created_at,
      expires_at: rotated.expires_at,
      label: rotated.label
    });
    return;
  }

  notFound(response);
}

await new Promise<void>((resolve, reject) => {
  const onError = (error: Error) => {
    server.off("listening", onListening);
    reject(error);
  };
  const onListening = () => {
    server.off("error", onError);
    resolve();
  };

  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(config.port, config.bindHost);
});

console.log(`Viewer board listening on http://${config.bindHost}:${config.port}`);
console.log(`Viewer board token store: ${path.join(config.dataDir, "tokens.json")}`);
console.log(`Viewer board snapshot root: ${path.join(config.dataDir, "snapshots")}`);

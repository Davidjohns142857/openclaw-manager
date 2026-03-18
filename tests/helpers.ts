import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bootstrapManager } from "../src/skill/bootstrap.ts";
import { ManagerServer } from "../src/api/server.ts";
import { PublishedUiServer } from "../src/api/published-ui-server.ts";
import type { ManagerConfig } from "../src/shared/types.ts";

export async function createTempManager(overrides: Partial<ManagerConfig> = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openclaw-manager-test-"));
  const boot = await bootstrapManager({
    stateRoot: tempRoot,
    port: 0,
    ...overrides
  });

  return {
    ...boot,
    tempRoot,
    async cleanup() {
      boot.publicFactAutoSubmitService.stop();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await rm(tempRoot, { recursive: true, force: true });
          return;
        } catch (error) {
          if (attempt === 4) {
            throw error;
          }

          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    }
  };
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  let raw = "";

  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function startTempSidecar(overrides: Partial<ManagerConfig> = {}) {
  const manager = await createTempManager(overrides);
  const server = new ManagerServer(
    manager.controlPlane,
    manager.config,
    manager.publicFactAutoSubmitService
  );
  await server.start();

  const address = server.server.address();
  if (!address || typeof address === "string") {
    await server.stop();
    await manager.cleanup();
    throw new Error("Failed to resolve temporary sidecar address.");
  }

  return {
    ...manager,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async cleanup() {
      await server.stop();
      await manager.cleanup();
    }
  };
}

export async function startTempPublishedUi(overrides: Partial<ManagerConfig> = {}) {
  const manager = await createTempManager({
    ...overrides,
    port: overrides.port ?? 9911,
    ui: {
      public_base_url: "https://manager.example.com",
      publish_port: 0,
      publish_bind_host: "127.0.0.1",
      ...overrides.ui
    }
  });
  const server = new PublishedUiServer(
    manager.controlPlane,
    manager.config,
    manager.publicFactAutoSubmitService
  );
  await server.start();

  const address = server.server.address();
  if (!address || typeof address === "string") {
    await server.stop();
    await manager.cleanup();
    throw new Error("Failed to resolve temporary published UI address.");
  }

  return {
    ...manager,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async cleanup() {
      await server.stop();
      await manager.cleanup();
    }
  };
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function sessionPaths(tempRoot: string, sessionId: string, runId: string) {
  const sessionDir = path.join(tempRoot, "sessions", sessionId);
  const runDir = path.join(sessionDir, "runs", runId);

  return {
    sessionDir,
    sessionJson: path.join(sessionDir, "session.json"),
    summary: path.join(sessionDir, "summary.md"),
    attention: path.join(sessionDir, "attention.json"),
    sessionEvents: path.join(sessionDir, "events.jsonl"),
    runDir,
    runJson: path.join(runDir, "run.json"),
    checkpoint: path.join(runDir, "checkpoint.json"),
    events: path.join(runDir, "events.jsonl")
  };
}

export async function dispatchRoute(
  server: { route: (request: never, response: never) => Promise<void> },
  method: string,
  url: string,
  body?: unknown
): Promise<{ statusCode: number; headers: Record<string, unknown>; body: unknown }> {
  const result = await dispatchRawRoute(server, method, url, body);

  return {
    statusCode: result.statusCode,
    headers: result.headers,
    body: result.bodyText ? JSON.parse(result.bodyText) : null
  };
}

export async function dispatchRawRoute(
  server: { route: (request: never, response: never) => Promise<void> },
  method: string,
  url: string,
  body?: unknown
): Promise<{ statusCode: number; headers: Record<string, unknown>; bodyText: string }> {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const request = {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (payload) {
        yield Buffer.from(payload);
      }
    }
  };

  let statusCode = 200;
  let headers: Record<string, unknown> = {};
  let responseText = "";
  const response = {
    writeHead(code: number, nextHeaders: Record<string, unknown>) {
      statusCode = code;
      headers = nextHeaders;
      return this;
    },
    end(chunk?: string) {
      responseText += chunk ?? "";
    }
  };

  await server.route(request as never, response as never);

  return {
    statusCode,
    headers,
    bodyText: responseText
  };
}

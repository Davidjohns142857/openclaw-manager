import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bootstrapManager } from "../src/skill/bootstrap.ts";
import { ManagerServer } from "../src/api/server.ts";

export async function createTempManager() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openclaw-manager-test-"));
  const boot = await bootstrapManager({
    stateRoot: tempRoot,
    port: 0
  });

  return {
    ...boot,
    tempRoot,
    async cleanup() {
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
  const raw = await readFile(filePath, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
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
  server: ManagerServer,
  method: string,
  url: string,
  body?: unknown
): Promise<{ statusCode: number; headers: Record<string, unknown>; body: unknown }> {
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
    body: responseText ? JSON.parse(responseText) : null
  };
}

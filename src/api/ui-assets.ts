import { readFile as fsReadFile } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";

function jsonResponse(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

export async function serveStaticUiFile(
  uiRoot: string,
  response: ServerResponse,
  pathname: string,
  mountPath: string
): Promise<void> {
  let filePath: string;

  if (pathname === mountPath || pathname === `${mountPath}/`) {
    filePath = path.join(uiRoot, "index.html");
  } else {
    const relativePath = pathname.startsWith(`${mountPath}/`)
      ? pathname.slice(`${mountPath}/`.length)
      : pathname.slice(mountPath.length + 1);
    filePath = path.join(uiRoot, relativePath);
  }

  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(uiRoot))) {
    jsonResponse(response, 403, { error: "Forbidden" });
    return;
  }

  const mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff"
  };

  try {
    const content = await fsReadFile(resolved);
    const ext = path.extname(resolved);
    response.writeHead(200, {
      "content-type": mimeTypes[ext] ?? "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    response.end(content);
  } catch {
    const isRouteLikePath = path.extname(resolved).length === 0;

    if (!isRouteLikePath) {
      jsonResponse(response, 404, {
        error: "UI asset not found."
      });
      return;
    }

    try {
      const indexContent = await fsReadFile(path.join(uiRoot, "index.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(indexContent);
    } catch {
      jsonResponse(response, 404, {
        error: "UI files not found. Is ui/session-console/ present?"
      });
    }
  }
}

export async function serveUiFile(
  repoRoot: string,
  response: ServerResponse,
  pathname: string
): Promise<void> {
  await serveStaticUiFile(path.join(repoRoot, "ui", "session-console"), response, pathname, "/ui");
}

export async function serveBoardUiFile(
  repoRoot: string,
  response: ServerResponse,
  pathname: string,
  mountPath: string
): Promise<void> {
  await serveStaticUiFile(path.join(repoRoot, "board", "ui"), response, pathname, mountPath);
}

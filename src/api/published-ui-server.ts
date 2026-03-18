import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ControlPlane } from "../control-plane/control-plane.ts";
import { buildApiContractIndex } from "./contracts.ts";
import { buildHealthPayload } from "./health.ts";
import {
  serializeCapabilityFactOutboxDetail,
  serializeLocalDistillation,
  serializeSession,
  serializeSessionDetail,
  serializeSessionTimeline
} from "./serializers.ts";
import { serveUiFile } from "./ui-assets.ts";
import type { ManagerConfig } from "../shared/types.ts";
import type { PublicFactAutoSubmitService } from "../telemetry/public-fact-auto-submit.ts";

function jsonResponse(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
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

function matchSessionRoute(pathname: string, action?: string): string | null {
  const parts = splitPath(pathname);

  if (parts[0] !== "sessions") {
    return null;
  }

  if (!action && parts.length === 2) {
    return parts[1] ?? null;
  }

  if (action && parts.length === 3 && parts[2] === action) {
    return parts[1] ?? null;
  }

  return null;
}

function matchPublicFactOutboxDetailRoute(pathname: string): { batchId: string } | null {
  const parts = splitPath(pathname);
  if (parts.length === 3 && parts[0] === "public-facts" && parts[1] === "outbox") {
    return {
      batchId: parts[2] ?? ""
    };
  }

  return null;
}

function readOnlyRejected(response: ServerResponse): void {
  response.writeHead(405, {
    allow: "GET",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(
    `${JSON.stringify(
      {
        error:
          "Published session console is read-only. Use the local sidecar or OpenClaw commands for mutations."
      },
      null,
      2
    )}\n`
  );
}

export class PublishedUiServer {
  controlPlane: ControlPlane;
  config: ManagerConfig;
  publicFactAutoSubmitService: PublicFactAutoSubmitService | null;
  server;

  constructor(
    controlPlane: ControlPlane,
    config: ManagerConfig,
    publicFactAutoSubmitService: PublicFactAutoSubmitService | null = null
  ) {
    this.controlPlane = controlPlane;
    this.config = config;
    this.publicFactAutoSubmitService = publicFactAutoSubmitService;
    this.server = createServer((request, response) => {
      void this.route(request, response);
    });
  }

  private effectivePort(): number | null {
    const address = this.server.address();
    return address && typeof address !== "string" ? address.port : this.config.ui.publish_port;
  }

  async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname;

      if (request.method !== "GET") {
        readOnlyRejected(response);
        return;
      }

      if (pathname === "/") {
        redirectResponse(response, "/ui");
        return;
      }

      if (pathname === "/health") {
        const sessions = await this.controlPlane.listTasks();
        const payload = buildHealthPayload(
          this.config,
          sessions.length,
          this.publicFactAutoSubmitService?.getStatus(),
          this.config.port,
          { ui_read_only: true }
        );
        const uiRecord =
          typeof payload.ui === "object" && payload.ui !== null
            ? (payload.ui as Record<string, unknown>)
            : null;
        if (uiRecord) {
          const publishProxy =
            typeof uiRecord.publish_proxy === "object" && uiRecord.publish_proxy !== null
              ? (uiRecord.publish_proxy as Record<string, unknown>)
              : null;
          if (publishProxy) {
            publishProxy.port = this.effectivePort();
          }
        }
        delete payload.state_root;
        payload.server_role = "published_ui_proxy";
        jsonResponse(response, 200, payload);
        return;
      }

      if (pathname === "/commands") {
        jsonResponse(response, 200, []);
        return;
      }

      if (pathname === "/contracts") {
        jsonResponse(response, 200, buildApiContractIndex());
        return;
      }

      if (pathname === "/sessions") {
        const sessions = await this.controlPlane.listTasks();
        const payload = await Promise.all(
          sessions.map(async (session) => {
            const run = session.active_run_id
              ? await this.controlPlane.store.readRun(session.session_id, session.active_run_id)
              : await this.controlPlane.getLatestRun(session.session_id);

            return serializeSession(session, run);
          })
        );

        jsonResponse(response, 200, payload);
        return;
      }

      if (pathname === "/focus") {
        jsonResponse(response, 200, await this.controlPlane.focus());
        return;
      }

      if (pathname === "/digest") {
        jsonResponse(response, 200, { digest: await this.controlPlane.digest() });
        return;
      }

      if (pathname === "/bindings") {
        jsonResponse(response, 200, await this.controlPlane.listBindingsWithFilters({}));
        return;
      }

      if (pathname === "/distillation/local") {
        jsonResponse(
          response,
          200,
          serializeLocalDistillation(await this.controlPlane.getLocalDistillation())
        );
        return;
      }

      if (pathname === "/public-facts/outbox") {
        jsonResponse(response, 200, await this.controlPlane.listFactOutboxBatches());
        return;
      }

      const publicFactBatchDetailRoute = matchPublicFactOutboxDetailRoute(pathname);
      if (publicFactBatchDetailRoute) {
        jsonResponse(
          response,
          200,
          serializeCapabilityFactOutboxDetail(
            await this.controlPlane.getFactOutboxBatch(publicFactBatchDetailRoute.batchId)
          )
        );
        return;
      }

      const sessionId = matchSessionRoute(pathname);
      if (sessionId) {
        jsonResponse(
          response,
          200,
          serializeSessionDetail(await this.controlPlane.getSessionDetail(sessionId))
        );
        return;
      }

      const timelineSessionId = matchSessionRoute(pathname, "timeline");
      if (timelineSessionId) {
        jsonResponse(
          response,
          200,
          serializeSessionTimeline(await this.controlPlane.getSessionTimeline(timelineSessionId))
        );
        return;
      }

      if (pathname === "/ui" || pathname.startsWith("/ui/")) {
        await serveUiFile(this.config.repoRoot, response, pathname);
        return;
      }

      jsonResponse(response, 404, {
        error: "Not found"
      });
    } catch (error) {
      jsonResponse(response, 500, {
        error: error instanceof Error ? error.message : "Unknown server error"
      });
    }
  }

  async start(): Promise<void> {
    const publishPort = this.config.ui.publish_port;

    if (publishPort === null) {
      throw new Error("Published UI proxy port is not configured.");
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };

      this.server.once("error", onError);
      this.server.listen(publishPort, this.config.ui.publish_bind_host, onListening);
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

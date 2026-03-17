import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { CloseSessionInput } from "../shared/contracts.ts";
import { ControlPlane } from "../control-plane/control-plane.ts";
import { buildApiContractIndex } from "./contracts.ts";
import { handleInboundApi } from "./inbound.ts";
import { buildHealthPayload } from "./health.ts";
import { managerCommands } from "../skill/commands.ts";
import type { ManagerConfig } from "../shared/types.ts";
import { serializeSession, serializeSessionDetail } from "./serializers.ts";

function jsonResponse(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

function matchSessionRoute(pathname: string, action?: string): string | null {
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] !== "sessions") {
    return null;
  }

  if (!action && parts.length === 2) {
    return decodeURIComponent(parts[1]);
  }

  if (action && parts.length === 3 && parts[2] === action) {
    return decodeURIComponent(parts[1]);
  }

  return null;
}

export class ManagerServer {
  controlPlane: ControlPlane;
  config: ManagerConfig;
  server;

  constructor(controlPlane: ControlPlane, config: ManagerConfig) {
    this.controlPlane = controlPlane;
    this.config = config;
    this.server = createServer((request, response) => {
      void this.route(request, response);
    });
  }

  async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname;

      if (request.method === "GET" && pathname === "/health") {
        const sessions = await this.controlPlane.listTasks();
        jsonResponse(response, 200, buildHealthPayload(this.config, sessions.length));
        return;
      }

      if (request.method === "GET" && pathname === "/commands") {
        jsonResponse(response, 200, managerCommands);
        return;
      }

      if (request.method === "GET" && pathname === "/contracts") {
        jsonResponse(response, 200, buildApiContractIndex());
        return;
      }

      if (request.method === "GET" && pathname === "/sessions") {
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

      if (request.method === "GET" && pathname === "/focus") {
        jsonResponse(response, 200, await this.controlPlane.focus());
        return;
      }

      if (request.method === "GET" && pathname === "/digest") {
        jsonResponse(response, 200, { digest: await this.controlPlane.digest() });
        return;
      }

      const sessionId = matchSessionRoute(pathname);
      if (request.method === "GET" && sessionId) {
        jsonResponse(
          response,
          200,
          serializeSessionDetail(await this.controlPlane.getSessionDetail(sessionId))
        );
        return;
      }

      if (request.method === "POST" && pathname === "/adopt") {
        const body = await readJsonBody(request);
        const adopted = await this.controlPlane.adoptSession({
          title: String(body.title ?? "Untitled task"),
          objective: String(body.objective ?? "No objective provided"),
          owner_ref: typeof body.owner_ref === "string" ? body.owner_ref : undefined,
          priority:
            body.priority === "low" ||
            body.priority === "medium" ||
            body.priority === "high" ||
            body.priority === "critical"
              ? body.priority
              : undefined,
          tags: Array.isArray(body.tags)
            ? body.tags.filter((value): value is string => typeof value === "string")
            : undefined,
          next_machine_actions: Array.isArray(body.next_machine_actions)
            ? body.next_machine_actions.filter((value): value is string => typeof value === "string")
            : undefined
        });
        jsonResponse(
          response,
          200,
          serializeSessionDetail(await this.controlPlane.getSessionDetail(adopted.session.session_id))
        );
        return;
      }

      if (request.method === "POST" && pathname === "/inbound-message") {
        const body = await readJsonBody(request);
        jsonResponse(response, 200, await handleInboundApi(this.controlPlane, {
          request_id: typeof body.request_id === "string" ? body.request_id : undefined,
          external_trigger_id:
            typeof body.external_trigger_id === "string" ? body.external_trigger_id : null,
          source_type: String(body.source_type ?? ""),
          source_thread_key: String(body.source_thread_key ?? ""),
          target_session_id: String(body.target_session_id ?? ""),
          message_type:
            body.message_type === "system_update" ||
            body.message_type === "artifact_notice" ||
            body.message_type === "decision_response"
              ? body.message_type
              : "user_message",
          content: String(body.content ?? ""),
          attachments: Array.isArray(body.attachments)
            ? body.attachments.filter(
                (value): value is { name?: string; mime_type?: string; ref?: string } =>
                  typeof value === "object" && value !== null
              )
            : [],
          metadata:
            typeof body.metadata === "object" && body.metadata !== null
              ? (body.metadata as Record<string, unknown>)
              : {}
        }));
        return;
      }

      const resumeSessionId = matchSessionRoute(pathname, "resume");
      if (request.method === "POST" && resumeSessionId) {
        const resumed = await this.controlPlane.resumeSession(resumeSessionId);
        jsonResponse(
          response,
          200,
          serializeSessionDetail({
            session: resumed.session,
            run: resumed.run,
            checkpoint: resumed.checkpoint,
            summary: resumed.summary
          })
        );
        return;
      }

      const checkpointSessionId = matchSessionRoute(pathname, "checkpoint");
      if (request.method === "POST" && checkpointSessionId) {
        const refreshed = await this.controlPlane.refreshCheckpoint(checkpointSessionId);
        jsonResponse(
          response,
          200,
          serializeSessionDetail({
            session: refreshed.session,
            run: refreshed.run,
            checkpoint: refreshed.checkpoint,
            summary: refreshed.summary
          })
        );
        return;
      }

      const shareSessionId = matchSessionRoute(pathname, "share");
      if (request.method === "POST" && shareSessionId) {
        jsonResponse(response, 200, await this.controlPlane.shareSession(shareSessionId));
        return;
      }

      const closeSessionId = matchSessionRoute(pathname, "close");
      if (request.method === "POST" && closeSessionId) {
        const body = (await readJsonBody(request)) as Partial<CloseSessionInput>;
        await this.controlPlane.closeSession(closeSessionId, {
          resolution: body.resolution === "abandoned" ? "abandoned" : "completed",
          outcome_summary: body.outcome_summary ?? "Closed through API.",
          metadata: body.metadata ?? {}
        });
        jsonResponse(
          response,
          200,
          serializeSessionDetail(await this.controlPlane.getSessionDetail(closeSessionId))
        );
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
      this.server.listen(this.config.port, "127.0.0.1", onListening);
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

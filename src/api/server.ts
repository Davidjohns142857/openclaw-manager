import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type {
  BindingListFilters,
  BindSourceInput,
  ClearBlockerInput,
  CloseSessionInput,
  DetectBlockerInput,
  DisableBindingInput,
  RequestHumanDecisionInput,
  RebindSourceInput,
  ResolveHumanDecisionInput,
  SubmitPublicFactsInput
} from "../shared/contracts.ts";
import { ControlPlane } from "../control-plane/control-plane.ts";
import {
  ConnectorBindingConflictError,
  ConnectorBindingNotFoundError
} from "../control-plane/binding-service.ts";
import { buildApiContractIndex } from "./contracts.ts";
import { handleInboundApi } from "./inbound.ts";
import { buildHealthPayload } from "./health.ts";
import { buildUserFacingSessionUrl } from "../shared/ui.ts";
import { serveUiFile } from "./ui-assets.ts";
import { managerCommands } from "../skill/commands.ts";
import type { ManagerConfig } from "../shared/types.ts";
import { normalizeBrowserConnectorMessage } from "../connectors/browser.ts";
import { normalizeGitHubWebhook } from "../connectors/github.ts";
import type { HostCapturedMessage } from "../host/context.ts";
import { runManagerPreRoutingViaControlPlane } from "../host/server-sidecar.ts";
import {
  serializeBindSourceResult,
  serializeCapabilityFactOutboxDetail,
  serializeDisableBindingResult,
  serializeLocalDistillation,
  serializeRebindSourceResult,
  serializeReservedMutationResult,
  serializeSession,
  serializeSessionDetail,
  serializeSessionTimeline,
  serializeSubmitPublicFactsResult
} from "./serializers.ts";
import type { PublicFactAutoSubmitService } from "../telemetry/public-fact-auto-submit.ts";

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

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

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
}

function matchDecisionCollectionRoute(pathname: string): string | null {
  const parts = splitPath(pathname);
  return parts.length === 3 && parts[0] === "sessions" && parts[2] === "decisions" ? parts[1] : null;
}

function matchDecisionResolveRoute(pathname: string): { sessionId: string; decisionId: string } | null {
  const parts = splitPath(pathname);
  if (
    parts.length === 5 &&
    parts[0] === "sessions" &&
    parts[2] === "decisions" &&
    parts[4] === "resolve"
  ) {
    return {
      sessionId: parts[1],
      decisionId: parts[3]
    };
  }

  return null;
}

function matchBlockerCollectionRoute(pathname: string): string | null {
  const parts = splitPath(pathname);
  return parts.length === 3 && parts[0] === "sessions" && parts[2] === "blockers" ? parts[1] : null;
}

function matchBlockerClearRoute(pathname: string): { sessionId: string; blockerId: string } | null {
  const parts = splitPath(pathname);
  if (
    parts.length === 5 &&
    parts[0] === "sessions" &&
    parts[2] === "blockers" &&
    parts[4] === "clear"
  ) {
    return {
      sessionId: parts[1],
      blockerId: parts[3]
    };
  }

  return null;
}

function matchBindingActionRoute(
  pathname: string,
  action: string
): { bindingId: string } | null {
  const parts = splitPath(pathname);
  if (parts.length === 3 && parts[0] === "bindings" && parts[2] === action) {
    return {
      bindingId: parts[1]
    };
  }

  return null;
}

function matchPublicFactOutboxDetailRoute(pathname: string): { batchId: string } | null {
  const parts = splitPath(pathname);
  if (parts.length === 3 && parts[0] === "public-facts" && parts[1] === "outbox") {
    return {
      batchId: parts[2]
    };
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asPriority(value: unknown): "low" | "medium" | "high" | "critical" | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "critical"
    ? value
    : undefined;
}

function asBindingStatus(value: unknown): "active" | "disabled" | undefined {
  return value === "active" || value === "disabled" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function asSourceChannel(
  value: unknown
): { source_type: string; source_ref: string; bound_at: string; metadata?: Record<string, unknown> } | undefined {
  const candidate = asRecord(value);
  if (!candidate) {
    return undefined;
  }

  if (
    typeof candidate.source_type !== "string" ||
    typeof candidate.source_ref !== "string" ||
    typeof candidate.bound_at !== "string"
  ) {
    return undefined;
  }

  return {
    source_type: candidate.source_type,
    source_ref: candidate.source_ref,
    bound_at: candidate.bound_at,
    metadata: asRecord(candidate.metadata)
  };
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${fieldName} must be a non-empty string.`);
  }

  return value;
}

function asBadRequest(error: unknown, fallbackMessage: string): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  return new HttpError(400, error instanceof Error ? error.message : fallbackMessage);
}

function parseRequestHumanDecisionInput(body: Record<string, unknown>): RequestHumanDecisionInput {
  return {
    decision_id: typeof body.decision_id === "string" ? body.decision_id : undefined,
    summary: requireNonEmptyString(body.summary, "summary"),
    urgency: asPriority(body.urgency),
    requested_by_ref: typeof body.requested_by_ref === "string" ? body.requested_by_ref : undefined,
    requested_at: typeof body.requested_at === "string" ? body.requested_at : undefined,
    next_human_actions: asStringArray(body.next_human_actions),
    metadata: asRecord(body.metadata)
  };
}

function parseResolveHumanDecisionInput(body: Record<string, unknown>): ResolveHumanDecisionInput {
  return {
    resolution_summary: requireNonEmptyString(body.resolution_summary, "resolution_summary"),
    resolved_by_ref: typeof body.resolved_by_ref === "string" ? body.resolved_by_ref : undefined,
    resolved_at: typeof body.resolved_at === "string" ? body.resolved_at : undefined,
    next_machine_actions: asStringArray(body.next_machine_actions),
    next_human_actions: asStringArray(body.next_human_actions),
    metadata: asRecord(body.metadata)
  };
}

function parseDetectBlockerInput(body: Record<string, unknown>): DetectBlockerInput {
  return {
    blocker_id: typeof body.blocker_id === "string" ? body.blocker_id : undefined,
    type: requireNonEmptyString(body.type, "type"),
    summary: requireNonEmptyString(body.summary, "summary"),
    severity: asPriority(body.severity),
    detected_by_ref: typeof body.detected_by_ref === "string" ? body.detected_by_ref : undefined,
    detected_at: typeof body.detected_at === "string" ? body.detected_at : undefined,
    next_human_actions: asStringArray(body.next_human_actions),
    metadata: asRecord(body.metadata)
  };
}

function parseClearBlockerInput(body: Record<string, unknown>): ClearBlockerInput {
  return {
    resolution_summary: requireNonEmptyString(body.resolution_summary, "resolution_summary"),
    cleared_by_ref: typeof body.cleared_by_ref === "string" ? body.cleared_by_ref : undefined,
    cleared_at: typeof body.cleared_at === "string" ? body.cleared_at : undefined,
    next_machine_actions: asStringArray(body.next_machine_actions),
    next_human_actions: asStringArray(body.next_human_actions),
    metadata: asRecord(body.metadata)
  };
}

function parseBindSourceInput(body: Record<string, unknown>): BindSourceInput {
  return {
    session_id: requireNonEmptyString(body.session_id, "session_id"),
    source_type: requireNonEmptyString(body.source_type, "source_type"),
    source_thread_key: requireNonEmptyString(body.source_thread_key, "source_thread_key"),
    metadata: asRecord(body.metadata)
  };
}

function asSubmitMode(value: unknown): SubmitPublicFactsInput["mode"] | undefined {
  return value === "dry-run" || value === "local-file" || value === "mock-http" || value === "http"
    ? value
    : undefined;
}

function asMockTransportResult(
  value: unknown
): SubmitPublicFactsInput["mock_response"] | undefined {
  return value === "accepted" ||
    value === "duplicate" ||
    value === "retryable_error" ||
    value === "rejected"
    ? value
    : undefined;
}

function parseSubmitPublicFactsInput(body: Record<string, unknown>): SubmitPublicFactsInput {
  const mode = asSubmitMode(body.mode);

  if (!mode) {
    throw new HttpError(400, "mode must be one of dry-run, local-file, mock-http, or http.");
  }

  return {
    mode,
    max_batch_size:
      typeof body.max_batch_size === "number" && Number.isFinite(body.max_batch_size)
        ? body.max_batch_size
        : undefined,
    max_batches:
      typeof body.max_batches === "number" && Number.isFinite(body.max_batches)
        ? body.max_batches
        : undefined,
    retry_failed_retryable:
      typeof body.retry_failed_retryable === "boolean" ? body.retry_failed_retryable : undefined,
    mock_response: asMockTransportResult(body.mock_response)
  };
}

function parseDisableBindingInput(body: Record<string, unknown>): DisableBindingInput {
  return {
    reason: typeof body.reason === "string" ? body.reason : undefined,
    disabled_by_ref: typeof body.disabled_by_ref === "string" ? body.disabled_by_ref : undefined,
    disabled_at: typeof body.disabled_at === "string" ? body.disabled_at : undefined,
    metadata: asRecord(body.metadata)
  };
}

function parseRebindSourceInput(body: Record<string, unknown>): RebindSourceInput {
  return {
    session_id: requireNonEmptyString(body.session_id, "session_id"),
    rebound_by_ref: typeof body.rebound_by_ref === "string" ? body.rebound_by_ref : undefined,
    rebound_at: typeof body.rebound_at === "string" ? body.rebound_at : undefined,
    metadata: asRecord(body.metadata)
  };
}

function parseBindingListFilters(url: URL): BindingListFilters {
  const statusValue = url.searchParams.get("status");
  if (statusValue !== null && !asBindingStatus(statusValue)) {
    throw new HttpError(400, "status must be active or disabled.");
  }

  return {
    binding_id: url.searchParams.get("binding_id") ?? undefined,
    session_id: url.searchParams.get("session_id") ?? undefined,
    source_type: url.searchParams.get("source_type") ?? undefined,
    source_thread_key: url.searchParams.get("source_thread_key") ?? undefined,
    status: asBindingStatus(statusValue)
  };
}

function parseHostCapturedMessage(body: Record<string, unknown>): HostCapturedMessage {
  return {
    text: requireNonEmptyString(body.text, "text"),
    source_type: requireNonEmptyString(body.source_type, "source_type"),
    source_thread_key:
      typeof body.source_thread_key === "string" ? body.source_thread_key : undefined,
    message_id: typeof body.message_id === "string" ? body.message_id : undefined,
    received_at: typeof body.received_at === "string" ? body.received_at : undefined,
    metadata: asRecord(body.metadata)
  };
}

function readHeader(request: IncomingMessage, headerName: string): string | undefined {
  const value = request.headers[headerName.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" ? value : undefined;
}

export class ManagerServer {
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

  private effectivePort(): number {
    const address = this.server.address();
    return address && typeof address !== "string" ? address.port : this.config.port;
  }

  async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname;

      if (request.method === "GET" && pathname === "/health") {
        const sessions = await this.controlPlane.listTasks();
        jsonResponse(
          response,
          200,
          buildHealthPayload(
            this.config,
            sessions.length,
            this.publicFactAutoSubmitService?.getStatus(),
            this.effectivePort()
          )
        );
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

      if (request.method === "GET" && pathname === "/bindings") {
        jsonResponse(response, 200, await this.controlPlane.listBindingsWithFilters(parseBindingListFilters(url)));
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

      if (request.method === "GET" && pathname === "/distillation/local") {
        jsonResponse(
          response,
          200,
          serializeLocalDistillation(await this.controlPlane.getLocalDistillation())
        );
        return;
      }

      if (request.method === "POST" && pathname === "/distill") {
        jsonResponse(
          response,
          200,
          serializeLocalDistillation(await this.controlPlane.distillLocalFacts())
        );
        return;
      }

      if (request.method === "GET" && pathname === "/public-facts/outbox") {
        jsonResponse(response, 200, await this.controlPlane.listFactOutboxBatches());
        return;
      }

      const publicFactBatchDetailRoute = matchPublicFactOutboxDetailRoute(pathname);
      if (request.method === "GET" && publicFactBatchDetailRoute) {
        jsonResponse(
          response,
          200,
          serializeCapabilityFactOutboxDetail(
            await this.controlPlane.getFactOutboxBatch(publicFactBatchDetailRoute.batchId)
          )
        );
        return;
      }

      if (request.method === "POST" && pathname === "/public-facts/submit") {
        const body = await readJsonBody(request);
        jsonResponse(
          response,
          200,
          serializeSubmitPublicFactsResult(
            await this.controlPlane.submitPublicFacts(parseSubmitPublicFactsInput(body))
          )
        );
        return;
      }

      if (request.method === "POST" && pathname === "/bind") {
        const body = await readJsonBody(request);
        jsonResponse(
          response,
          200,
          serializeBindSourceResult(await this.controlPlane.bindSource(parseBindSourceInput(body)))
        );
        return;
      }

      const disableBindingRoute = matchBindingActionRoute(pathname, "disable");
      if (request.method === "POST" && disableBindingRoute) {
        const body = await readJsonBody(request);
        jsonResponse(
          response,
          200,
          serializeDisableBindingResult(
            await this.controlPlane.disableBinding(
              disableBindingRoute.bindingId,
              parseDisableBindingInput(body)
            )
          )
        );
        return;
      }

      const rebindBindingRoute = matchBindingActionRoute(pathname, "rebind");
      if (request.method === "POST" && rebindBindingRoute) {
        const body = await readJsonBody(request);
        jsonResponse(
          response,
          200,
          serializeRebindSourceResult(
            await this.controlPlane.rebindBinding(
              rebindBindingRoute.bindingId,
              parseRebindSourceInput(body)
            )
          )
        );
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

      const timelineSessionId = matchSessionRoute(pathname, "timeline");
      if (request.method === "GET" && timelineSessionId) {
        jsonResponse(
          response,
          200,
          serializeSessionTimeline(await this.controlPlane.getSessionTimeline(timelineSessionId))
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
          scenario_signature:
            typeof body.scenario_signature === "string" ? body.scenario_signature : undefined,
          source_channel: asSourceChannel(body.source_channel),
          next_machine_actions: Array.isArray(body.next_machine_actions)
            ? body.next_machine_actions.filter((value): value is string => typeof value === "string")
            : undefined,
          metadata: asRecord(body.metadata)
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
          target_session_id:
            typeof body.target_session_id === "string" ? body.target_session_id : undefined,
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

      if (request.method === "POST" && pathname === "/host/prerouting") {
        const body = await readJsonBody(request);
        jsonResponse(
          response,
          200,
          await runManagerPreRoutingViaControlPlane(
            this.controlPlane,
            parseHostCapturedMessage(body),
            {
              session_console_url: buildUserFacingSessionUrl({
                public_base_url: this.config.ui.public_base_url,
                board_push_url: this.config.board_sync.board_push_url,
                board_token: this.config.board_sync.board_token
              })
            }
          )
        );
        return;
      }

      if (request.method === "POST" && pathname === "/connectors/github/events") {
        const body = await readJsonBody(request);
        let normalized;

        try {
          normalized = normalizeGitHubWebhook({
            delivery_id: readHeader(request, "x-github-delivery") ?? null,
            event: readHeader(request, "x-github-event") ?? "",
            body
          });
        } catch (error) {
          throw asBadRequest(error, "Invalid GitHub webhook payload.");
        }

        if (normalized.ignored) {
          jsonResponse(response, 202, normalized);
          return;
        }

        jsonResponse(response, 200, {
          ...normalized,
          ...(await handleInboundApi(this.controlPlane, normalized.inbound))
        });
        return;
      }

      if (request.method === "POST" && pathname === "/connectors/browser/messages") {
        const body = await readJsonBody(request);
        let normalized;

        try {
          normalized = normalizeBrowserConnectorMessage({
            source_thread_key:
              typeof body.source_thread_key === "string" ? body.source_thread_key : "",
            message_id: typeof body.message_id === "string" ? body.message_id : "",
            text: typeof body.text === "string" ? body.text : "",
            page_url: typeof body.page_url === "string" ? body.page_url : null,
            page_title: typeof body.page_title === "string" ? body.page_title : null,
            selection_text:
              typeof body.selection_text === "string" ? body.selection_text : null,
            captured_at: typeof body.captured_at === "string" ? body.captured_at : undefined,
            metadata: asRecord(body.metadata)
          });
        } catch (error) {
          throw asBadRequest(error, "Invalid browser connector payload.");
        }

        jsonResponse(response, 200, {
          accepted: normalized.accepted,
          source_type: normalized.source_type,
          source_thread_key: normalized.source_thread_key,
          message_id: normalized.message_id,
          request_id: normalized.request_id,
          ...(await handleInboundApi(this.controlPlane, normalized.inbound))
        });
        return;
      }

      const decisionSessionId = matchDecisionCollectionRoute(pathname);
      if (request.method === "POST" && decisionSessionId) {
        const body = await readJsonBody(request);
        const result = await this.controlPlane.requestHumanDecision(
          decisionSessionId,
          parseRequestHumanDecisionInput(body)
        );
        jsonResponse(
          response,
          result.status === "not_enabled" ? 501 : result.status === "rejected" ? 409 : 200,
          serializeReservedMutationResult(result)
        );
        return;
      }

      const decisionResolve = matchDecisionResolveRoute(pathname);
      if (request.method === "POST" && decisionResolve) {
        const body = await readJsonBody(request);
        const result = await this.controlPlane.resolveHumanDecision(
          decisionResolve.sessionId,
          decisionResolve.decisionId,
          parseResolveHumanDecisionInput(body)
        );
        jsonResponse(
          response,
          result.status === "not_enabled" ? 501 : result.status === "rejected" ? 409 : 200,
          serializeReservedMutationResult(result)
        );
        return;
      }

      const blockerSessionId = matchBlockerCollectionRoute(pathname);
      if (request.method === "POST" && blockerSessionId) {
        const body = await readJsonBody(request);
        const result = await this.controlPlane.detectBlocker(
          blockerSessionId,
          parseDetectBlockerInput(body)
        );
        jsonResponse(
          response,
          result.status === "not_enabled" ? 501 : result.status === "rejected" ? 409 : 200,
          serializeReservedMutationResult(result)
        );
        return;
      }

      const blockerClear = matchBlockerClearRoute(pathname);
      if (request.method === "POST" && blockerClear) {
        const body = await readJsonBody(request);
        const result = await this.controlPlane.clearBlocker(
          blockerClear.sessionId,
          blockerClear.blockerId,
          parseClearBlockerInput(body)
        );
        jsonResponse(
          response,
          result.status === "not_enabled" ? 501 : result.status === "rejected" ? 409 : 200,
          serializeReservedMutationResult(result)
        );
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

      // ── Static UI files ──
      if (pathname === "/ui" || pathname.startsWith("/ui/")) {
        await this.serveUiFile(response, pathname);
        return;
      }

      jsonResponse(response, 404, {
        error: "Not found"
      });
    } catch (error) {
      if (error instanceof ConnectorBindingConflictError) {
        jsonResponse(response, 409, {
          error: error.message
        });
        return;
      }

      if (error instanceof ConnectorBindingNotFoundError) {
        jsonResponse(response, 404, {
          error: error.message
        });
        return;
      }

      jsonResponse(response, error instanceof HttpError ? error.statusCode : 500, {
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

  private async serveUiFile(response: ServerResponse, pathname: string): Promise<void> {
    await serveUiFile(this.config.repoRoot, response, pathname);
  }
}

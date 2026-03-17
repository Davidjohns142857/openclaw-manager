import type { ExternalInboundMessageInput } from "../connectors/base.ts";
import type { BrowserConnectorMessageInput } from "../connectors/browser.ts";
import type { SessionActivity } from "../shared/activity.ts";
import type { SessionStatusReason } from "../shared/session-status.ts";
import type {
  AdoptSessionInput,
  BindingListFilters,
  BindSourceInput,
  BindSourceResult,
  ClearBlockerInput,
  CloseSessionInput,
  DetectBlockerInput,
  DisableBindingInput,
  DisableBindingResult,
  RequestHumanDecisionInput,
  RebindSourceInput,
  RebindSourceResult,
  ReservedContractMutationResult,
  ResolveHumanDecisionInput,
  SessionTimelineView,
  ShareSnapshotResult
} from "../shared/contracts.ts";
import type {
  AttentionUnit,
  Checkpoint,
  ConnectorBinding,
  LocalDistillationSnapshot,
  Run,
  Session
} from "../shared/types.ts";
import type { ManagerCommandClient, ManagerCommandDefinition } from "./commands.ts";

export interface SessionWithActivity extends Session {
  activity: SessionActivity;
  status_reason: SessionStatusReason;
}

export interface SessionDetailEnvelope {
  session: SessionWithActivity;
  run: Run | null;
  checkpoint: Checkpoint | null;
  summary: string | null;
}

export interface InboundMessageResponse {
  duplicate: boolean;
  queued: boolean;
  run_started: boolean;
  run: Run | null;
  session: SessionWithActivity;
}

export interface BrowserConnectorEnvelope extends InboundMessageResponse {
  accepted: true;
  source_type: "browser";
  source_thread_key: string;
  message_id: string;
  request_id: string;
}

export interface ReservedMutationEnvelope
  extends Omit<ReservedContractMutationResult, "session"> {
  session: SessionWithActivity;
}

export interface BindSourceEnvelope extends Omit<BindSourceResult, "binding" | "session"> {
  binding: ConnectorBinding;
  session: SessionWithActivity;
}

export interface DisableBindingEnvelope extends Omit<DisableBindingResult, "binding" | "session"> {
  binding: ConnectorBinding;
  session: SessionWithActivity;
}

export interface RebindSourceEnvelope extends Omit<RebindSourceResult, "binding" | "session"> {
  binding: ConnectorBinding;
  session: SessionWithActivity;
}

export interface ManagerSidecarClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  headers?: HeadersInit;
}

export class ManagerSidecarHttpError extends Error {
  statusCode: number;
  payload: unknown;

  constructor(statusCode: number, payload: unknown) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as Record<string, unknown>).error === "string"
        ? String((payload as Record<string, unknown>).error)
        : `Manager sidecar request failed with status ${statusCode}.`;

    super(message);
    this.name = "ManagerSidecarHttpError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

export function resolveManagerBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (typeof env.OPENCLAW_MANAGER_BASE_URL === "string" && env.OPENCLAW_MANAGER_BASE_URL.trim()) {
    return env.OPENCLAW_MANAGER_BASE_URL;
  }

  return `http://127.0.0.1:${env.OPENCLAW_MANAGER_PORT ?? "8791"}`;
}

export class ManagerSidecarClient implements ManagerCommandClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: HeadersInit | undefined;

  constructor(options: ManagerSidecarClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? resolveManagerBaseUrl());
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = options.headers;
  }

  async health(): Promise<Record<string, unknown>> {
    return this.request("GET", "/health");
  }

  async listCommands(): Promise<ManagerCommandDefinition[]> {
    return this.request("GET", "/commands");
  }

  async listSessions(): Promise<SessionWithActivity[]> {
    return this.request("GET", "/sessions");
  }

  async listBindings(filters?: BindingListFilters): Promise<ConnectorBinding[]> {
    const search = new URLSearchParams();
    if (filters?.binding_id) {
      search.set("binding_id", filters.binding_id);
    }
    if (filters?.session_id) {
      search.set("session_id", filters.session_id);
    }
    if (filters?.source_type) {
      search.set("source_type", filters.source_type);
    }
    if (filters?.source_thread_key) {
      search.set("source_thread_key", filters.source_thread_key);
    }
    if (filters?.status) {
      search.set("status", filters.status);
    }

    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return this.request("GET", `/bindings${suffix}`);
  }

  async getSession(sessionId: string): Promise<SessionDetailEnvelope> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}`);
  }

  async getSessionTimeline(sessionId: string): Promise<SessionTimelineView> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}/timeline`);
  }

  async focus(): Promise<AttentionUnit[]> {
    return this.request("GET", "/focus");
  }

  async digest(): Promise<{ digest: string }> {
    return this.request("GET", "/digest");
  }

  async getLocalDistillation(): Promise<LocalDistillationSnapshot | null> {
    return this.request("GET", "/distillation/local");
  }

  async distill(): Promise<LocalDistillationSnapshot | null> {
    return this.request("POST", "/distill");
  }

  async adopt(input: AdoptSessionInput): Promise<SessionDetailEnvelope> {
    return this.request("POST", "/adopt", input);
  }

  async bind(input: BindSourceInput): Promise<BindSourceEnvelope> {
    return this.request("POST", "/bind", input);
  }

  async disableBinding(
    bindingId: string,
    input: DisableBindingInput = {}
  ): Promise<DisableBindingEnvelope> {
    return this.request("POST", `/bindings/${encodeURIComponent(bindingId)}/disable`, input);
  }

  async rebindBinding(
    bindingId: string,
    input: RebindSourceInput
  ): Promise<RebindSourceEnvelope> {
    return this.request("POST", `/bindings/${encodeURIComponent(bindingId)}/rebind`, input);
  }

  async resume(sessionId: string): Promise<SessionDetailEnvelope> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/resume`);
  }

  async checkpoint(sessionId: string): Promise<SessionDetailEnvelope> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/checkpoint`);
  }

  async share(sessionId: string): Promise<ShareSnapshotResult> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/share`);
  }

  async close(sessionId: string, input: CloseSessionInput): Promise<SessionDetailEnvelope> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/close`, input);
  }

  async inboundMessage(message: ExternalInboundMessageInput): Promise<InboundMessageResponse> {
    return this.request("POST", "/inbound-message", message);
  }

  async captureBrowserMessage(
    message: BrowserConnectorMessageInput
  ): Promise<BrowserConnectorEnvelope> {
    return this.request("POST", "/connectors/browser/messages", message);
  }

  async requestHumanDecision(
    sessionId: string,
    input: RequestHumanDecisionInput
  ): Promise<ReservedMutationEnvelope> {
    return this.requestWithAcceptedStatuses(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/decisions`,
      [200, 409, 501],
      input
    );
  }

  async resolveHumanDecision(
    sessionId: string,
    decisionId: string,
    input: ResolveHumanDecisionInput
  ): Promise<ReservedMutationEnvelope> {
    return this.requestWithAcceptedStatuses(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/decisions/${encodeURIComponent(decisionId)}/resolve`,
      [200, 409, 501],
      input
    );
  }

  async detectBlocker(
    sessionId: string,
    input: DetectBlockerInput
  ): Promise<ReservedMutationEnvelope> {
    return this.requestWithAcceptedStatuses(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/blockers`,
      [200, 409, 501],
      input
    );
  }

  async clearBlocker(
    sessionId: string,
    blockerId: string,
    input: ClearBlockerInput
  ): Promise<ReservedMutationEnvelope> {
    return this.requestWithAcceptedStatuses(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/blockers/${encodeURIComponent(blockerId)}/clear`,
      [200, 409, 501],
      input
    );
  }

  private async request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const { response, payload } = await this.send(method, pathname, body);

    if (!response.ok) {
      throw new ManagerSidecarHttpError(response.status, payload);
    }

    return payload as T;
  }

  private async requestWithAcceptedStatuses<T>(
    method: string,
    pathname: string,
    acceptedStatuses: number[],
    body?: unknown
  ): Promise<T> {
    const { response, payload } = await this.send(method, pathname, body);

    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      throw new ManagerSidecarHttpError(response.status, payload);
    }

    return payload as T;
  }

  private async send(
    method: string,
    pathname: string,
    body?: unknown
  ): Promise<{ response: Response; payload: unknown }> {
    const response = await this.fetchImpl(new URL(stripLeadingSlash(pathname), this.baseUrl), {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json; charset=utf-8" }),
        ...(this.headers ?? {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    return {
      response,
      payload: await parseResponseBody(response)
    };
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function stripLeadingSlash(pathname: string): string {
  return pathname.startsWith("/") ? pathname.slice(1) : pathname;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

import type { SessionActivity } from "../shared/activity.ts";
import type {
  AdoptSessionInput,
  ClearBlockerInput,
  CloseSessionInput,
  DetectBlockerInput,
  RequestHumanDecisionInput,
  ReservedContractMutationResult,
  ResolveHumanDecisionInput,
  ShareSnapshotResult
} from "../shared/contracts.ts";
import type { AttentionUnit, Checkpoint, NormalizedInboundMessage, Run, Session } from "../shared/types.ts";
import type { ManagerCommandClient, ManagerCommandDefinition } from "./commands.ts";

export interface SessionWithActivity extends Session {
  activity: SessionActivity;
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

export interface ReservedMutationEnvelope
  extends Omit<ReservedContractMutationResult, "session"> {
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

  async getSession(sessionId: string): Promise<SessionDetailEnvelope> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}`);
  }

  async focus(): Promise<AttentionUnit[]> {
    return this.request("GET", "/focus");
  }

  async digest(): Promise<{ digest: string }> {
    return this.request("GET", "/digest");
  }

  async adopt(input: AdoptSessionInput): Promise<SessionDetailEnvelope> {
    return this.request("POST", "/adopt", input);
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

  async inboundMessage(message: NormalizedInboundMessage): Promise<InboundMessageResponse> {
    return this.request("POST", "/inbound-message", message);
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

import { readLocalChainConfig } from "../../src/host/local-chain.ts";

const DEFAULT_MANAGER_BASE_URL = "http://127.0.0.1:8791";
const DEFAULT_TIMEOUT_MS = 2500;

type HookAction =
  | "continue_default_routing"
  | "show_adopt_suggestion"
  | "short_circuit_to_manager";

interface HookEventContext {
  content?: string;
  channelId?: string;
  conversationId?: string;
  messageId?: string;
  timestamp?: number;
  from?: string;
  metadata?: Record<string, unknown>;
}

export interface OpenClawManagerHookEvent {
  type: string;
  action: string;
  messages: string[];
  context: HookEventContext;
}

interface HostPreroutingResponse {
  action: HookAction;
  session_console_url: string;
  manager?: {
    outcome?: string;
    target_session_id?: string | null;
    suggestion?: {
      command?: string;
      title?: string;
      note?: string;
    } | null;
    inbound?: {
      duplicate?: boolean;
    } | null;
  };
}

interface HookHandlerOptions {
  fetchImpl?: typeof fetch;
  managerBaseUrl?: string;
  timeoutMs?: number;
}

export async function handleOpenClawManagerPreroutingEvent(
  event: OpenClawManagerHookEvent,
  options: HookHandlerOptions = {}
): Promise<void> {
  if (!isInboundMessageEvent(event)) {
    return;
  }

  const content = normalizeText(event.context.content);
  if (!content || looksLikeExplicitCommand(content)) {
    return;
  }

  const response = await callManagerPrerouting(event, {
    fetchImpl: options.fetchImpl ?? fetch,
    managerBaseUrl: await resolveManagerBaseUrl(options),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  });

  if (!response) {
    return;
  }

  if (response.action === "show_adopt_suggestion") {
    event.messages.push(renderSuggestionMessage(response));
    return;
  }

  if (
    response.action === "short_circuit_to_manager" &&
    response.manager?.inbound?.duplicate !== true
  ) {
    event.messages.push(renderDirectAdoptMessage(response));
  }
}

export default async function openclawManagerPreroutingHook(
  event: OpenClawManagerHookEvent
): Promise<void> {
  await handleOpenClawManagerPreroutingEvent(event);
}

async function callManagerPrerouting(
  event: OpenClawManagerHookEvent,
  options: Required<HookHandlerOptions>
): Promise<HostPreroutingResponse | null> {
  const payload = {
    text: normalizeText(event.context.content),
    source_type: cleanText(event.context.channelId) ?? "openclaw_message",
    source_thread_key:
      cleanText(event.context.conversationId) ??
      cleanText(readMetadataString(event.context.metadata, "threadId")) ??
      cleanText(event.context.from) ??
      undefined,
    message_id: cleanText(event.context.messageId) ?? undefined,
    received_at: toIsoTimestamp(event.context.timestamp),
    metadata: {
      hook: "openclaw-manager-prerouting",
      from: cleanText(event.context.from) ?? null,
      conversation_id: cleanText(event.context.conversationId) ?? null,
      metadata: event.context.metadata ?? {}
    }
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(250, options.timeoutMs));

  try {
    const response = await options.fetchImpl(
      new URL("/host/prerouting", options.managerBaseUrl).toString(),
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      console.warn(
        `[openclaw-manager-prerouting] manager returned ${response.status} for host prerouting.`
      );
      return null;
    }

    return (await response.json()) as HostPreroutingResponse;
  } catch (error) {
    console.warn(
      `[openclaw-manager-prerouting] failed to reach manager sidecar: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveManagerBaseUrl(options: HookHandlerOptions): Promise<string> {
  if (options.managerBaseUrl?.trim()) {
    return normalizeBaseUrl(options.managerBaseUrl);
  }

  if (process.env.OPENCLAW_MANAGER_BASE_URL?.trim()) {
    return normalizeBaseUrl(process.env.OPENCLAW_MANAGER_BASE_URL);
  }

  const config = await readLocalChainConfig();
  if (config?.manager_base_url) {
    return normalizeBaseUrl(config.manager_base_url);
  }

  return normalizeBaseUrl(DEFAULT_MANAGER_BASE_URL);
}

function renderSuggestionMessage(response: HostPreroutingResponse): string {
  const title = cleanText(response.manager?.suggestion?.title);
  const note = cleanText(response.manager?.suggestion?.note);

  return [
    "OpenClaw Manager 建议把这条消息交给持久任务控制面处理。",
    title ? `建议标题：${title}` : null,
    "如需持久跟进，请执行 `/adopt`。",
    note ? `判定原因：${note}` : null,
    response.session_console_url ? `控制台：${response.session_console_url}` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function renderDirectAdoptMessage(response: HostPreroutingResponse): string {
  const sessionId = cleanText(response.manager?.target_session_id);

  return [
    "OpenClaw Manager 已收编这条长期任务消息。",
    sessionId ? `session_id: ${sessionId}` : null,
    "后续继续发自然语言消息即可，manager 会按 source thread 归入同一 session。",
    response.session_console_url ? `控制台：${response.session_console_url}` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function isInboundMessageEvent(event: OpenClawManagerHookEvent): boolean {
  return event.type === "message" && event.action === "received";
}

function looksLikeExplicitCommand(content: string): boolean {
  return content.startsWith("/");
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: unknown): string {
  return cleanText(value)?.replace(/\s+/g, " ") ?? "";
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | null {
  return metadata && typeof metadata[key] === "string" ? cleanText(metadata[key]) : null;
}

function toIsoTimestamp(timestamp: number | undefined): string | undefined {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

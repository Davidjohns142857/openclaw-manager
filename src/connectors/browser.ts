import { createHash } from "node:crypto";

import type { ExternalInboundMessageInput } from "./base.ts";

export interface BrowserConnectorMessageInput {
  source_thread_key: string;
  message_id: string;
  text: string;
  page_url?: string | null;
  page_title?: string | null;
  selection_text?: string | null;
  captured_at?: string;
  metadata?: Record<string, unknown>;
}

export interface BrowserAcceptedMessage {
  accepted: true;
  source_type: "browser";
  source_thread_key: string;
  message_id: string;
  request_id: string;
  inbound: ExternalInboundMessageInput;
}

export function browserThreadKey(surface: string, threadId: string): string {
  const normalizedSurface = requireNonEmptyString(surface, "surface");
  const normalizedThreadId = requireNonEmptyString(threadId, "thread_id");
  return `browser:${normalizedSurface}/threads/${normalizedThreadId}`;
}

export function normalizeBrowserConnectorMessage(
  input: BrowserConnectorMessageInput
): BrowserAcceptedMessage {
  const sourceThreadKey = requireNonEmptyString(input.source_thread_key, "source_thread_key");
  const messageId = requireNonEmptyString(input.message_id, "message_id");
  const text = requireNonEmptyString(input.text, "text");
  const requestId = deriveBrowserRequestId(sourceThreadKey, messageId);
  const pageUrl = cleanOptional(input.page_url);
  const pageTitle = cleanOptional(input.page_title);
  const selectionText = cleanOptional(input.selection_text);

  return {
    accepted: true,
    source_type: "browser",
    source_thread_key: sourceThreadKey,
    message_id: messageId,
    request_id: requestId,
    inbound: {
      request_id: requestId,
      external_trigger_id: messageId,
      source_type: "browser",
      source_thread_key: sourceThreadKey,
      message_type: "user_message",
      content: text,
      attachments: pageUrl
        ? [
            {
              name: "browser_page",
              ref: pageUrl
            }
          ]
        : [],
      metadata: {
        connector: "browser",
        page_url: pageUrl,
        page_title: pageTitle,
        selection_text: selectionText,
        client_metadata: input.metadata ?? {}
      },
      timestamp: typeof input.captured_at === "string" ? input.captured_at : undefined
    }
  };
}

function deriveBrowserRequestId(sourceThreadKey: string, messageId: string): string {
  const seed = JSON.stringify({
    source_thread_key: sourceThreadKey,
    message_id: messageId
  });

  return `req_browser_${createHash("sha1").update(seed).digest("hex").slice(0, 16)}`;
}

function requireNonEmptyString(value: string | null | undefined, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Browser connector payload is missing ${fieldName}.`);
  }

  return value.trim();
}

function cleanOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

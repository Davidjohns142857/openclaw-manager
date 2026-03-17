import { createId } from "../shared/ids.ts";
import { isoNow } from "../shared/time.ts";
import type { AttachmentRef, NormalizedInboundMessage } from "../shared/types.ts";

export interface ExternalInboundMessageInput {
  request_id?: string;
  external_trigger_id?: string | null;
  source_type: string;
  source_thread_key: string;
  target_session_id?: string;
  message_type: NormalizedInboundMessage["message_type"];
  content: string;
  attachments?: AttachmentRef[];
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export interface NormalizeInboundMessageInput extends ExternalInboundMessageInput {
  target_session_id: string;
}

export function normalizeInboundMessage(
  input: NormalizeInboundMessageInput
): NormalizedInboundMessage {
  return {
    request_id: input.request_id ?? createId("req"),
    external_trigger_id: input.external_trigger_id ?? null,
    source_type: input.source_type,
    source_thread_key: input.source_thread_key,
    target_session_id: input.target_session_id,
    message_type: input.message_type,
    content: input.content,
    attachments: input.attachments ?? [],
    timestamp: input.timestamp ?? isoNow(),
    metadata: input.metadata ?? {}
  };
}

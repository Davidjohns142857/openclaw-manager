import { createHash } from "node:crypto";

import type { AdoptSessionInput } from "../shared/contracts.ts";
import type { InboundMessageResponse, SessionDetailEnvelope } from "../skill/sidecar-client.ts";
import { isoNow } from "../shared/time.ts";
import type { AttentionUnit, NormalizedInboundMessage } from "../shared/types.ts";
import type {
  HostAdmissionAssessment,
  HostAdmissionPolicy
} from "./admission-policy.ts";
import { RuleBasedHostAdmissionPolicy, shouldSuggestAdopt } from "./admission-policy.ts";
import type {
  HostAdmissionContext,
  HostCapturedMessage,
  HostContextClient
} from "./context.ts";
import { collectHostContext, resolveHostCaptureKey } from "./context.ts";

export interface HostAdmissionManagerClient extends HostContextClient {
  adopt(input: AdoptSessionInput): Promise<SessionDetailEnvelope>;
  inboundMessage(message: NormalizedInboundMessage): Promise<InboundMessageResponse>;
  focus(): Promise<AttentionUnit[]>;
}

export interface HostAdoptSuggestion {
  command: "/adopt";
  title: string;
  objective: string;
  note: string;
}

export interface SuggestOrAdoptResult {
  context: HostAdmissionContext;
  assessment: HostAdmissionAssessment;
  outcome: "ignored" | "suggested" | "adopted_new_session" | "routed_to_existing_session";
  suggestion: HostAdoptSuggestion | null;
  adopted: SessionDetailEnvelope | null;
  inbound: InboundMessageResponse | null;
  target_session_id: string | null;
}

export async function suggestOrAdopt(
  client: HostAdmissionManagerClient,
  message: HostCapturedMessage,
  policy: HostAdmissionPolicy = new RuleBasedHostAdmissionPolicy()
): Promise<SuggestOrAdoptResult> {
  const context = await collectHostContext(client, message);
  const assessment = shouldSuggestAdopt(context, policy);
  const suggestion = buildAdoptSuggestion(message, assessment);

  if (assessment.decision === "do_nothing") {
    return {
      context,
      assessment,
      outcome: "ignored",
      suggestion: null,
      adopted: null,
      inbound: null,
      target_session_id: null
    };
  }

  if (assessment.decision === "suggest_adopt") {
    return {
      context,
      assessment,
      outcome: "suggested",
      suggestion,
      adopted: null,
      inbound: null,
      target_session_id: assessment.existing_session_match?.session_id ?? null
    };
  }

  const existingSourceThreadMatch =
    assessment.existing_session_match?.match_type === "source_thread"
      ? assessment.existing_session_match
      : null;

  if (existingSourceThreadMatch) {
    const inbound = await client.inboundMessage(buildInboundMessage(message, assessment, existingSourceThreadMatch.session_id));

    return {
      context,
      assessment,
      outcome: "routed_to_existing_session",
      suggestion: null,
      adopted: null,
      inbound,
      target_session_id: existingSourceThreadMatch.session_id
    };
  }

  const adopted = await client.adopt(buildAdoptInput(message, assessment));
  const inbound = await client.inboundMessage(
    buildInboundMessage(message, assessment, adopted.session.session_id)
  );

  return {
    context,
    assessment,
    outcome: "adopted_new_session",
    suggestion: null,
    adopted,
    inbound,
    target_session_id: adopted.session.session_id
  };
}

function buildAdoptSuggestion(
  message: HostCapturedMessage,
  assessment: HostAdmissionAssessment
): HostAdoptSuggestion {
  const title = deriveTitleFromMessage(message.text);

  return {
    command: "/adopt",
    title,
    objective: normalizeText(message.text),
    note: `Reason: ${assessment.reason_codes.join(", ") || "task_like_message"}`
  };
}

function buildAdoptInput(
  message: HostCapturedMessage,
  assessment: HostAdmissionAssessment
): AdoptSessionInput {
  const boundAt = message.received_at ?? isoNow();
  const captureKey = requireCaptureKey(message);
  const sourceThreadKey = message.source_thread_key?.trim();

  if (!sourceThreadKey) {
    throw new Error("source_thread_key is required for direct host capture.");
  }

  return {
    title: deriveTitleFromMessage(message.text),
    objective: normalizeText(message.text),
    source_channel: {
      source_type: message.source_type,
      source_ref: sourceThreadKey,
      bound_at: boundAt,
      metadata: {
        bound_via: "host_message_capture",
        capture_key: captureKey
      }
    },
    tags: deriveTags(assessment.reason_codes),
    scenario_signature: "host_message_capture.rule_based.v1",
    metadata: {
      created_via: "host_message_capture",
      host_capture: {
        source_type: message.source_type,
        source_thread_key: message.source_thread_key ?? null,
        message_id: message.message_id ?? null,
        capture_key: captureKey,
        received_at: message.received_at ?? null,
        original_text: normalizeText(message.text)
      },
      admission: {
        decision: assessment.decision,
        reason_codes: assessment.reason_codes,
        confidence: assessment.confidence
      }
    }
  };
}

function buildInboundMessage(
  message: HostCapturedMessage,
  assessment: HostAdmissionAssessment,
  targetSessionId: string
): NormalizedInboundMessage {
  const captureKey = requireCaptureKey(message);
  const sourceThreadKey = message.source_thread_key?.trim();

  if (!sourceThreadKey) {
    throw new Error("source_thread_key is required for direct host capture.");
  }

  return {
    request_id: deriveRequestId(message),
    external_trigger_id: null,
    source_type: message.source_type,
    source_thread_key: sourceThreadKey,
    target_session_id: targetSessionId,
    message_type: "user_message",
    content: normalizeText(message.text),
    attachments: [],
    timestamp: message.received_at ?? isoNow(),
    metadata: {
      imported_via: "host_message_capture",
      capture_key: captureKey,
      admission_decision: assessment.decision,
      admission_reason_codes: assessment.reason_codes,
      admission_confidence: assessment.confidence,
      host_message_id: message.message_id ?? null
    }
  };
}

function deriveTitleFromMessage(text: string): string {
  const normalized = normalizeText(text);
  const firstSentence = normalized.split(/[。！？!?;\n]/u).find((line) => line.trim().length > 0)?.trim();
  const candidate = firstSentence && firstSentence.length <= 48 ? firstSentence : normalized.slice(0, 48);

  return candidate.length === normalized.length ? candidate : `${candidate.trim()}...`;
}

function deriveTags(reasonCodes: string[]): string[] {
  const map = new Map<string, string>([
    ["keyword_research", "research"],
    ["keyword_follow_up", "follow_up"],
    ["keyword_project", "project"],
    ["keyword_task", "task"],
    ["keyword_todo", "todo"],
    ["keyword_deliverable", "deliverable"]
  ]);

  return [...new Set(reasonCodes.map((code) => map.get(code)).filter((tag): tag is string => Boolean(tag)))];
}

function deriveRequestId(message: HostCapturedMessage): string {
  const seed = requireCaptureKey(message);

  return `req_host_${createDigest(seed).slice(0, 16)}`;
}

function requireCaptureKey(message: HostCapturedMessage): string {
  const captureKey = resolveHostCaptureKey(message);

  if (!captureKey) {
    throw new Error(
      "host message direct ingress requires source_type + source_thread_key + message_id."
    );
  }

  return captureKey;
}

function createDigest(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

import type { ExistingSessionMatch, HostAdmissionContext } from "./context.ts";

export type HostAdmissionDecision = "do_nothing" | "suggest_adopt" | "direct_adopt";

export interface HostAdmissionAssessment {
  decision: HostAdmissionDecision;
  reason_codes: string[];
  confidence: number;
  existing_session_match: ExistingSessionMatch | null;
}

export interface HostAdmissionPolicy {
  assess(context: HostAdmissionContext): HostAdmissionAssessment;
}

export class RuleBasedHostAdmissionPolicy implements HostAdmissionPolicy {
  assess(context: HostAdmissionContext): HostAdmissionAssessment {
    const keywordCount = context.keyword_hits.length;
    const structuralCount = context.structural_signals.length;
    const hasLongHorizon = context.structural_signals.includes("long_horizon_task");
    const hasStrongKeyword = context.keyword_hits.some((code) =>
      [
        "keyword_task",
        "keyword_research",
        "keyword_follow_up",
        "keyword_project",
        "keyword_todo"
      ].includes(code)
    );
    const hasStrongStructure = context.structural_signals.some((code) =>
      ["deliverable_present", "external_dependency", "follow_up_action"].includes(code)
    );
    const exactSourceMatch = context.existing_session_match?.match_type === "source_thread";
    const semanticMatch = context.existing_session_match?.match_type === "keyword_overlap";
    const overloaded = context.focus_backlog >= 6 || context.active_session_count >= 8;
    const hasStableSourceRef = context.source_thread_key !== null;
    const hasStableCaptureKey = context.capture_key !== null;

    if (exactSourceMatch && hasStableCaptureKey) {
      return {
        decision: "direct_adopt",
        reason_codes: ["existing_source_thread_match"],
        confidence: 0.98,
        existing_session_match: context.existing_session_match
      };
    }

    const reasonCodes = new Set<string>([
      ...context.keyword_hits,
      ...context.structural_signals,
      ...(semanticMatch ? ["existing_keyword_overlap"] : []),
      ...(!hasStableSourceRef ? ["missing_source_thread_key"] : []),
      ...(!hasStableCaptureKey ? ["missing_message_id"] : []),
      ...(overloaded ? ["focus_backlog_high"] : [])
    ]);

    const baseConfidence = clamp(
      0.08 +
        keywordCount * 0.14 +
        structuralCount * 0.11 +
        (hasLongHorizon ? 0.14 : 0) +
        (semanticMatch ? 0.08 : 0) -
        (overloaded ? 0.12 : 0),
      0.04,
      0.94
    );

    const directEligible =
      hasStableSourceRef &&
      hasStableCaptureKey &&
      !semanticMatch &&
      hasStrongKeyword &&
      hasLongHorizon &&
      hasStrongStructure &&
      !overloaded;

    if (directEligible) {
      return {
        decision: "direct_adopt",
        reason_codes: [...reasonCodes],
        confidence: clamp(baseConfidence + 0.14, 0.72, 0.95),
        existing_session_match: context.existing_session_match
      };
    }

    const suggestEligible =
      keywordCount > 0 ||
      structuralCount >= 2 ||
      semanticMatch ||
      (hasStrongKeyword && hasLongHorizon);

    if (suggestEligible) {
      return {
        decision: "suggest_adopt",
        reason_codes: [...reasonCodes],
        confidence: clamp(baseConfidence + 0.08, 0.46, 0.86),
        existing_session_match: context.existing_session_match
      };
    }

    return {
      decision: "do_nothing",
      reason_codes: [...reasonCodes],
      confidence: clamp(baseConfidence, 0.05, 0.4),
      existing_session_match: context.existing_session_match
    };
  }
}

export function shouldSuggestAdopt(
  context: HostAdmissionContext,
  policy: HostAdmissionPolicy = new RuleBasedHostAdmissionPolicy()
): HostAdmissionAssessment {
  return policy.assess(context);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

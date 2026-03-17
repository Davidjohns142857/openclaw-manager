import { createId } from "../shared/ids.ts";
import { readReservedContractState } from "../shared/reserved-contracts.ts";
import { addHours, hoursSince, isoNow } from "../shared/time.ts";
import { isTerminalSessionStatus } from "../shared/state.ts";
import type { AttentionCategory, AttentionUnit, Session } from "../shared/types.ts";
import { sortAttentionQueue } from "../storage/indexes.ts";

const urgencyScore = {
  low: 10,
  medium: 20,
  high: 40,
  critical: 80
} as const;

const priorityScore = {
  low: 1,
  medium: 4,
  high: 8,
  critical: 12
} as const;

const categoryPriority = {
  waiting_human: 5,
  blocked: 4,
  desynced: 3,
  stale: 2,
  summary_drift: 1
} satisfies Record<AttentionCategory, number>;

const primaryCategoryRule = "waiting_human > blocked > desynced > stale > summary_drift";

function sortSameSessionAttention(units: AttentionUnit[]): AttentionUnit[] {
  return [...units].sort((left, right) => {
    const categoryDelta = categoryPriority[right.category] - categoryPriority[left.category];
    if (categoryDelta !== 0) {
      return categoryDelta;
    }

    if (right.attention_priority !== left.attention_priority) {
      return right.attention_priority - left.attention_priority;
    }

    return right.created_at.localeCompare(left.created_at);
  });
}

export class AttentionService {
  buildAttentionForSession(session: Session): AttentionUnit[] {
    if (isTerminalSessionStatus(session.status)) {
      return [];
    }

    const items: AttentionUnit[] = [];
    const now = isoNow();
    const ageHours = hoursSince(session.metrics.last_activity_at);
    const reservedState = readReservedContractState(session);
    const effectivePendingDecisions =
      session.state.pending_human_decisions.length > 0
        ? session.state.pending_human_decisions.map((decision) => ({
            summary: decision.summary,
            urgency: decision.urgency
          }))
        : reservedState.pending_human_decisions.map((decision) => ({
            summary: decision.summary,
            urgency: decision.urgency
          }));
    const effectiveBlockers =
      session.state.blockers.length > 0
        ? session.state.blockers.map((blocker) => ({
            summary: blocker.summary,
            severity: blocker.severity
          }))
        : reservedState.blockers.map((blocker) => ({
            summary: blocker.summary,
            severity: blocker.severity
          }));

    if (effectivePendingDecisions.length > 0 || session.status === "waiting_human") {
      const urgency =
        effectivePendingDecisions[0]?.urgency ??
        (session.priority === "critical" ? "high" : "medium");

      items.push({
        attention_id: createId("attn"),
        session_id: session.session_id,
        category: "waiting_human",
        urgency,
        expected_human_action: "Resolve the pending human decision",
        reasoning_summary: effectivePendingDecisions
          .map((decision) => decision.summary)
          .join("; "),
        stale_after: addHours(now, 6),
        confidence: 0.9,
        recommended_next_step: "Review the decision list and unblock the session.",
        attention_priority: urgencyScore[urgency] + priorityScore[session.priority],
        metadata: {},
        created_at: now
      });
    }

    if (effectiveBlockers.length > 0 || session.status === "blocked" || session.metrics.failed_run_count >= 2) {
      const severity = effectiveBlockers[0]?.severity ?? "high";

      items.push({
        attention_id: createId("attn"),
        session_id: session.session_id,
        category: "blocked",
        urgency: severity,
        expected_human_action: "Remove or reframe the blocker",
        reasoning_summary:
          effectiveBlockers.map((blocker) => blocker.summary).join("; ") ||
          "Repeated failed runs suggest the thread is blocked.",
        stale_after: addHours(now, 12),
        confidence: 0.85,
        recommended_next_step: "Decide whether to retry, narrow scope, or switch strategy.",
        attention_priority: urgencyScore[severity] + priorityScore[session.priority] + 5,
        metadata: {},
        created_at: now
      });
    }

    if (ageHours >= 24) {
      const urgency = ageHours >= 72 ? "high" : "medium";

      items.push({
        attention_id: createId("attn"),
        session_id: session.session_id,
        category: "stale",
        urgency,
        expected_human_action: "Decide whether to resume, close, or ignore the session",
        reasoning_summary: `No meaningful activity for ${Math.floor(ageHours)}h.`,
        stale_after: addHours(session.metrics.last_activity_at, 24),
        confidence: 0.8,
        recommended_next_step: "Review the summary and either resume the task or close it cleanly.",
        attention_priority: urgencyScore[urgency] + priorityScore[session.priority],
        metadata: {},
        created_at: now
      });
    }

    const pendingInboundCount = Number(session.metadata.pending_inbound_count ?? 0);
    if (pendingInboundCount > 0 && !session.active_run_id) {
      items.push({
        attention_id: createId("attn"),
        session_id: session.session_id,
        category: "desynced",
        urgency: "medium",
        expected_human_action: "Confirm whether the inbound update should trigger work",
        reasoning_summary: `${pendingInboundCount} inbound update(s) are waiting without an active run.`,
        stale_after: addHours(now, 6),
        confidence: 0.75,
        recommended_next_step: "Resume the session or convert the new input into a decision item.",
        attention_priority: urgencyScore.medium + priorityScore[session.priority] + 3,
        metadata: {},
        created_at: now
      });
    }

    if (session.metadata.summary_needs_refresh === true) {
      items.push({
        attention_id: createId("attn"),
        session_id: session.session_id,
        category: "summary_drift",
        urgency: "low",
        expected_human_action: "Refresh the task summary",
        reasoning_summary: "Structured state changed after the last summary refresh.",
        stale_after: addHours(now, 24),
        confidence: 0.7,
        recommended_next_step: "Write a fresh checkpoint before resuming the session.",
        attention_priority: urgencyScore.low + priorityScore[session.priority],
        metadata: {},
        created_at: now
      });
    }

    if (items.length === 0) {
      return [];
    }

    const sorted = sortSameSessionAttention(items);
    const [primary, ...rest] = sorted;

    if (rest.length === 0) {
      return [
        {
          ...primary,
          metadata: {
            ...primary.metadata,
            primary_category_rule: primaryCategoryRule,
            merged_categories: [primary.category]
          }
        }
      ];
    }

    return [
      {
        ...primary,
        reasoning_summary: [primary.reasoning_summary, ...rest.map((item) => item.reasoning_summary)]
          .filter(Boolean)
          .join(" | "),
        metadata: {
          ...primary.metadata,
          primary_category_rule: primaryCategoryRule,
          merged_categories: [primary.category, ...rest.map((item) => item.category)]
        }
      }
    ];
  }

  buildAttentionQueue(sessions: Session[]): AttentionUnit[] {
    return sortAttentionQueue(sessions.flatMap((session) => this.buildAttentionForSession(session)));
  }
}

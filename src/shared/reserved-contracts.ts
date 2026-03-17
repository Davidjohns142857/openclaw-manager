import type { Priority, Session } from "./types.ts";

export interface ReservedPendingDecisionSummary {
  decision_id: string;
  summary: string;
  urgency: Priority;
  requested_at: string;
  requested_by_ref: string | null;
  metadata: Record<string, unknown>;
}

export interface ReservedBlockerSummary {
  blocker_id: string;
  type: string;
  summary: string;
  severity: Priority;
  detected_at: string;
  detected_by_ref: string | null;
  metadata: Record<string, unknown>;
}

export interface ReservedContractState {
  pending_human_decisions: ReservedPendingDecisionSummary[];
  blockers: ReservedBlockerSummary[];
}

const reservedContractStateKey = "reserved_contract_state";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parsePriority(value: unknown, fallback: Priority): Priority {
  return value === "low" || value === "medium" || value === "high" || value === "critical"
    ? value
    : fallback;
}

function parseReservedPendingDecisionSummary(value: unknown): ReservedPendingDecisionSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  if (typeof record.decision_id !== "string" || typeof record.summary !== "string") {
    return null;
  }

  return {
    decision_id: record.decision_id,
    summary: record.summary,
    urgency: parsePriority(record.urgency, "medium"),
    requested_at: typeof record.requested_at === "string" ? record.requested_at : "",
    requested_by_ref: typeof record.requested_by_ref === "string" ? record.requested_by_ref : null,
    metadata: asRecord(record.metadata) ?? {}
  };
}

function parseReservedBlockerSummary(value: unknown): ReservedBlockerSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  if (
    typeof record.blocker_id !== "string" ||
    typeof record.type !== "string" ||
    typeof record.summary !== "string"
  ) {
    return null;
  }

  return {
    blocker_id: record.blocker_id,
    type: record.type,
    summary: record.summary,
    severity: parsePriority(record.severity, "medium"),
    detected_at: typeof record.detected_at === "string" ? record.detected_at : "",
    detected_by_ref: typeof record.detected_by_ref === "string" ? record.detected_by_ref : null,
    metadata: asRecord(record.metadata) ?? {}
  };
}

export function readReservedContractState(session: Session): ReservedContractState {
  const record = asRecord(session.metadata[reservedContractStateKey]);
  const pending_human_decisions = Array.isArray(record?.pending_human_decisions)
    ? record.pending_human_decisions
        .map((item) => parseReservedPendingDecisionSummary(item))
        .filter((item): item is ReservedPendingDecisionSummary => item !== null)
    : [];
  const blockers = Array.isArray(record?.blockers)
    ? record.blockers
        .map((item) => parseReservedBlockerSummary(item))
        .filter((item): item is ReservedBlockerSummary => item !== null)
    : [];

  return {
    pending_human_decisions,
    blockers
  };
}

export function writeReservedContractState(
  session: Session,
  state: ReservedContractState
): Session {
  return {
    ...session,
    metadata: {
      ...session.metadata,
      [reservedContractStateKey]: state
    }
  };
}

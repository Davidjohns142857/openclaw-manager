import { readReservedContractState } from "./reserved-contracts.ts";
import type { Run, Session, SessionStatus } from "./types.ts";

const sessionStatusReasonKey = "session_status_reason";

export type SessionStatusSourceKind =
  | "terminal_session"
  | "paused_run"
  | "active_run"
  | "pending_human_decision"
  | "blocker"
  | "default_active";

export interface SessionStatusReason {
  status: SessionStatus;
  source_kind: SessionStatusSourceKind;
  source_run_id: string | null;
  source_run_status: string | null;
  source_decision_id: string | null;
  source_blocker_id: string | null;
}

export function deriveSessionStatusReason(
  session: Session,
  latestRun: Run | null
): SessionStatusReason {
  if (session.status === "completed" || session.status === "abandoned" || session.status === "archived") {
    return {
      status: session.status,
      source_kind: "terminal_session",
      source_run_id: null,
      source_run_status: null,
      source_decision_id: null,
      source_blocker_id: null
    };
  }

  if (latestRun?.status === "waiting_human" || latestRun?.status === "blocked") {
    return {
      status: latestRun.status,
      source_kind: "paused_run",
      source_run_id: latestRun.run_id,
      source_run_status: latestRun.status,
      source_decision_id: null,
      source_blocker_id: null
    };
  }

  const reservedState = readReservedContractState(session);
  const effectivePendingDecisions =
    session.state.pending_human_decisions.length > 0
      ? session.state.pending_human_decisions
      : reservedState.pending_human_decisions;

  if (effectivePendingDecisions.length > 0) {
    return {
      status: "waiting_human",
      source_kind: "pending_human_decision",
      source_run_id: null,
      source_run_status: null,
      source_decision_id: effectivePendingDecisions[0]?.decision_id ?? null,
      source_blocker_id: null
    };
  }

  const effectiveBlockers =
    session.state.blockers.length > 0 ? session.state.blockers : reservedState.blockers;

  if (effectiveBlockers.length > 0) {
    return {
      status: "blocked",
      source_kind: "blocker",
      source_run_id: null,
      source_run_status: null,
      source_decision_id: null,
      source_blocker_id: effectiveBlockers[0]?.blocker_id ?? null
    };
  }

  if (session.active_run_id || latestRun?.status === "accepted" || latestRun?.status === "queued" || latestRun?.status === "running") {
    return {
      status: "active",
      source_kind: "active_run",
      source_run_id: session.active_run_id ?? latestRun?.run_id ?? null,
      source_run_status: latestRun?.status ?? null,
      source_decision_id: null,
      source_blocker_id: null
    };
  }

  return {
    status: "active",
    source_kind: "default_active",
    source_run_id: null,
    source_run_status: null,
    source_decision_id: null,
    source_blocker_id: null
  };
}

export function applyDerivedSessionStatus(session: Session, latestRun: Run | null): Session {
  const reason = deriveSessionStatusReason(session, latestRun);

  return {
    ...session,
    status: reason.status,
    metadata: {
      ...session.metadata,
      [sessionStatusReasonKey]: reason
    }
  };
}

export function readSessionStatusReason(session: Session): SessionStatusReason | null {
  const candidate = session.metadata[sessionStatusReasonKey];

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const status = record.status;
  const sourceKind = record.source_kind;

  if (
    status !== "draft" &&
    status !== "active" &&
    status !== "waiting_human" &&
    status !== "blocked" &&
    status !== "completed" &&
    status !== "abandoned" &&
    status !== "archived"
  ) {
    return null;
  }

  if (
    sourceKind !== "terminal_session" &&
    sourceKind !== "paused_run" &&
    sourceKind !== "active_run" &&
    sourceKind !== "pending_human_decision" &&
    sourceKind !== "blocker" &&
    sourceKind !== "default_active"
  ) {
    return null;
  }

  return {
    status,
    source_kind: sourceKind,
    source_run_id: typeof record.source_run_id === "string" ? record.source_run_id : null,
    source_run_status: typeof record.source_run_status === "string" ? record.source_run_status : null,
    source_decision_id: typeof record.source_decision_id === "string" ? record.source_decision_id : null,
    source_blocker_id: typeof record.source_blocker_id === "string" ? record.source_blocker_id : null
  };
}

export function sameSessionStatusReason(
  left: SessionStatusReason | null,
  right: SessionStatusReason
): boolean {
  return (
    left?.status === right.status &&
    left?.source_kind === right.source_kind &&
    left?.source_run_id === right.source_run_id &&
    left?.source_run_status === right.source_run_status &&
    left?.source_decision_id === right.source_decision_id &&
    left?.source_blocker_id === right.source_blocker_id
  );
}

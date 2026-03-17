import type { Run, RunStatus, Session, SessionStatus } from "./types.ts";

const activeRunStatuses = new Set<RunStatus>(["accepted", "queued", "running"]);
const pausedRunStatuses = new Set<RunStatus>(["waiting_human", "blocked"]);
const endedRunStatuses = new Set<RunStatus>([
  "waiting_human",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "superseded"
]);
const recoveryHeadAdvancingStatuses = new Set<RunStatus>([
  "waiting_human",
  "blocked",
  "completed"
]);

export function isActiveRunStatus(status: RunStatus): boolean {
  return activeRunStatuses.has(status);
}

export function isPausedRunStatus(status: RunStatus): boolean {
  return pausedRunStatuses.has(status);
}

export function isEndedRunStatus(status: RunStatus): boolean {
  return endedRunStatuses.has(status);
}

export function canAdvanceRecoveryHeadForRunStatus(status: RunStatus): boolean {
  return recoveryHeadAdvancingStatuses.has(status);
}

export function shouldAutoStartRunOnResume(session: Session, latestRun: Run | null): boolean {
  if (session.status !== "active") {
    return false;
  }

  if (!latestRun) {
    return true;
  }

  return !isActiveRunStatus(latestRun.status) && !isPausedRunStatus(latestRun.status);
}

export function projectSessionStatusAfterRun(session: Session, run: Run): SessionStatus {
  if (run.status === "waiting_human") {
    return "waiting_human";
  }

  if (run.status === "blocked") {
    return "blocked";
  }

  if (session.state.pending_human_decisions.length > 0) {
    return "waiting_human";
  }

  if (session.state.blockers.length > 0) {
    return "blocked";
  }

  return "active";
}

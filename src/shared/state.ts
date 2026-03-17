import { deriveSessionStatusReason } from "./session-status.ts";
import type { Run, RunStatus, Session, SessionStatus } from "./types.ts";

const terminalSessionStatuses = new Set<SessionStatus>(["completed", "abandoned", "archived"]);
const terminalRunStatuses = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
  "superseded"
]);

export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return terminalSessionStatuses.has(status);
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return terminalRunStatuses.has(status);
}

export function canAutoContinueSession(session: Session, latestRun: Run | null = null): boolean {
  const statusReason = deriveSessionStatusReason(session, latestRun);

  return (
    statusReason.status === "active" &&
    !isTerminalSessionStatus(statusReason.status) &&
    session.state.blockers.length === 0 &&
    session.state.pending_human_decisions.length === 0
  );
}

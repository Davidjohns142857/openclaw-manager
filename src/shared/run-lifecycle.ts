import { deriveSessionStatusReason } from "./session-status.ts";
import type {
  Run,
  RunOutcome,
  RunResultType,
  RunStatus,
  Session,
  SessionStatus,
  SettledRunStatus
} from "./types.ts";

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
const settledRunStatuses = new Set<SettledRunStatus>([
  "waiting_human",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "superseded"
]);
const allowedResultTypesByStatus: Record<SettledRunStatus, readonly (RunResultType | null)[]> = {
  waiting_human: ["waiting_human"],
  blocked: ["blocked"],
  completed: ["completed", "partial_progress", "no_op"],
  failed: ["failed"],
  cancelled: [null],
  superseded: [null]
};

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

export function isSettledRunStatus(status: RunStatus): status is SettledRunStatus {
  return settledRunStatuses.has(status as SettledRunStatus);
}

export function allowedResultTypesForSettledRunStatus(
  status: SettledRunStatus
): readonly (RunResultType | null)[] {
  return allowedResultTypesByStatus[status];
}

export function defaultResultTypeForSettledRunStatus(
  status: SettledRunStatus
): RunResultType | null {
  switch (status) {
    case "waiting_human":
      return "waiting_human";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
    case "superseded":
      return null;
  }
}

export function defaultClosureContributionForRunResultType(
  resultType: RunResultType | null
): number | null {
  switch (resultType) {
    case "completed":
      return 1;
    case "partial_progress":
      return 0.5;
    case "no_op":
      return 0;
    default:
      return null;
  }
}

export function defaultHumanTakeoverForSettledRunStatus(status: SettledRunStatus): boolean {
  return status === "waiting_human";
}

export function buildSettledRunOutcome(
  status: SettledRunStatus,
  input: {
    result_type?: RunResultType | null;
    summary: string | null;
    reason_code?: string | null;
  }
): RunOutcome {
  const resultType = input.result_type ?? defaultResultTypeForSettledRunStatus(status);
  const outcome: RunOutcome = {
    result_type: resultType,
    summary: input.summary,
    reason_code: input.reason_code ?? null,
    human_takeover: defaultHumanTakeoverForSettledRunStatus(status),
    closure_contribution: defaultClosureContributionForRunResultType(resultType)
  };

  assertRunOutcomeMatchesStatus(status, outcome);
  return outcome;
}

export function assertRunOutcomeMatchesStatus(status: RunStatus, outcome: RunOutcome): void {
  if (!isSettledRunStatus(status)) {
    return;
  }

  const allowedResultTypes = allowedResultTypesForSettledRunStatus(status);

  if (!allowedResultTypes.some((allowed) => allowed === outcome.result_type)) {
    throw new Error(
      `Run status ${status} cannot use outcome.result_type=${String(outcome.result_type)}.`
    );
  }

  if (status === "waiting_human" && outcome.human_takeover !== true) {
    throw new Error("waiting_human runs must set outcome.human_takeover=true.");
  }

  if (status !== "waiting_human" && outcome.human_takeover) {
    throw new Error(`${status} runs cannot set outcome.human_takeover=true.`);
  }

  if ((status === "cancelled" || status === "superseded") && !outcome.reason_code) {
    throw new Error(`${status} runs must set outcome.reason_code.`);
  }

  switch (outcome.result_type) {
    case "completed":
      if (outcome.closure_contribution !== 1) {
        throw new Error("completed outcomes must set closure_contribution=1.");
      }
      break;
    case "partial_progress":
      if (
        outcome.closure_contribution === null ||
        outcome.closure_contribution <= 0 ||
        outcome.closure_contribution >= 1
      ) {
        throw new Error(
          "partial_progress outcomes must set closure_contribution to a value between 0 and 1."
        );
      }
      break;
    case "no_op":
      if (outcome.closure_contribution !== 0) {
        throw new Error("no_op outcomes must set closure_contribution=0.");
      }
      break;
    case "waiting_human":
    case "blocked":
    case "failed":
    case null:
      if (outcome.closure_contribution !== null) {
        throw new Error(
          `${String(outcome.result_type)} outcomes must set closure_contribution=null.`
        );
      }
      break;
  }
}

export function shouldAutoStartRunOnResume(session: Session, latestRun: Run | null): boolean {
  if (deriveSessionStatusReason(session, latestRun).status !== "active") {
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

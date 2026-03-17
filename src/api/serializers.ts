import { deriveSessionActivity } from "../shared/activity.ts";
import { deriveSessionStatusReason } from "../shared/session-status.ts";
import type {
  Checkpoint,
  ConnectorBinding,
  LocalDistillationSnapshot,
  Run,
  Session
} from "../shared/types.ts";
import type {
  BindSourceResult,
  DisableBindingResult,
  RebindSourceResult,
  ReservedContractMutationResult,
  SessionTimelineView
} from "../shared/contracts.ts";

export function serializeSession(session: Session, run: Run | null): Record<string, unknown> {
  const statusReason = deriveSessionStatusReason(session, run);

  return {
    ...session,
    status: statusReason.status,
    status_reason: statusReason,
    activity: deriveSessionActivity(session, run)
  };
}

export function serializeSessionDetail(detail: {
  session: Session;
  run: Run | null;
  checkpoint: Checkpoint | null;
  summary: string | null;
}): Record<string, unknown> {
  return {
    session: serializeSession(detail.session, detail.run),
    run: detail.run,
    checkpoint: detail.checkpoint,
    summary: detail.summary
  };
}

export function serializeReservedMutationResult(
  result: ReservedContractMutationResult
): Record<string, unknown> {
  return {
    contract_id: result.contract_id,
    feature_flag: result.feature_flag,
    status: result.status,
    error_code: result.error_code,
    mutation_applied: result.mutation_applied,
    ...serializeSessionDetail(result)
  };
}

export function serializeBinding(binding: ConnectorBinding): Record<string, unknown> {
  return {
    ...binding
  };
}

export function serializeBindSourceResult(result: BindSourceResult): Record<string, unknown> {
  return {
    binding: serializeBinding(result.binding),
    created: result.created,
    ...serializeSessionDetail(result)
  };
}

export function serializeDisableBindingResult(result: DisableBindingResult): Record<string, unknown> {
  return {
    binding: serializeBinding(result.binding),
    changed: result.changed,
    ...serializeSessionDetail(result)
  };
}

export function serializeRebindSourceResult(result: RebindSourceResult): Record<string, unknown> {
  return {
    binding: serializeBinding(result.binding),
    previous_session_id: result.previous_session_id,
    changed: result.changed,
    ...serializeSessionDetail(result)
  };
}

export function serializeSessionTimeline(result: SessionTimelineView): Record<string, unknown> {
  return {
    contract_id: result.contract_id,
    generated_at: result.generated_at,
    session: {
      ...result.session
    },
    run_count: result.run_count,
    runs: result.runs
  };
}

export function serializeLocalDistillation(
  snapshot: LocalDistillationSnapshot | null
): Record<string, unknown> | null {
  if (!snapshot) {
    return null;
  }

  return {
    contract_id: snapshot.contract_id,
    generated_at: snapshot.generated_at,
    source_session_count: snapshot.source_session_count,
    source_run_count: snapshot.source_run_count,
    scenario_count: snapshot.scenario_count,
    facts: snapshot.facts
  };
}

import { deriveSessionActivity } from "../shared/activity.ts";
import type { Checkpoint, ConnectorBinding, Run, Session } from "../shared/types.ts";
import type {
  BindSourceResult,
  DisableBindingResult,
  RebindSourceResult,
  ReservedContractMutationResult
} from "../shared/contracts.ts";

export function serializeSession(session: Session, run: Run | null): Record<string, unknown> {
  return {
    ...session,
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

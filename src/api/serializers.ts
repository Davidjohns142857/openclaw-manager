import { deriveSessionActivity } from "../shared/activity.ts";
import type { Checkpoint, Run, Session } from "../shared/types.ts";
import type { ReservedContractMutationResult } from "../shared/contracts.ts";

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

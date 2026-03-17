import { createId } from "../shared/ids.ts";
import { isoNow } from "../shared/time.ts";
import type { CapabilityFact, Run, Session } from "../shared/types.ts";

export class CapabilityFactService {
  emitClosureFacts(session: Session, run: Run | null): CapabilityFact[] {
    const computedAt = isoNow();
    const scenarioSignature = session.scenario_signature ?? "general.task_management";
    const evidenceRefs = [`sessions/${session.session_id}/session.json`];

    if (run) {
      evidenceRefs.push(`sessions/${session.session_id}/runs/${run.run_id}/run.json`);
    }

    return [
      {
        fact_id: createId("fact"),
        subject_type: "session",
        subject_ref: session.session_id,
        scenario_signature: scenarioSignature,
        metric_name: "closure_status",
        metric_value: session.status,
        sample_size: 1,
        confidence: 0.8,
        evidence_refs: evidenceRefs,
        metadata: {},
        computed_at: computedAt
      },
      {
        fact_id: createId("fact"),
        subject_type: "session",
        subject_ref: session.session_id,
        scenario_signature: scenarioSignature,
        metric_name: "run_count",
        metric_value: session.metrics.run_count,
        sample_size: 1,
        confidence: 0.9,
        evidence_refs: evidenceRefs,
        metadata: {},
        computed_at: computedAt
      }
    ];
  }
}


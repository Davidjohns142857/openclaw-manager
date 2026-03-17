import { createId } from "../shared/ids.ts";
import type { CapabilityFact, Run, Session } from "../shared/types.ts";

export class CapabilityFactService {
  emitClosureFacts(session: Session, run: Run | null): CapabilityFact[] {
    const computedAt = session.updated_at;
    const scenarioSignature = session.scenario_signature ?? "general.task_management";
    const evidenceRefs = [`sessions/${session.session_id}/session.json`];

    if (run) {
      evidenceRefs.push(`sessions/${session.session_id}/runs/${run.run_id}/run.json`);
    }

    return [
      {
        fact_id: createId("fact"),
        fact_kind: "raw_observation",
        subject: {
          subject_type: "session",
          subject_ref: session.session_id,
          subject_version: null
        },
        scenario_signature: scenarioSignature,
        metric_name: "closure_status",
        metric_value: session.status,
        sample_size: 1,
        confidence: 0.8,
        aggregation_window: {
          window_type: "point_in_time",
          start_at: session.created_at,
          end_at: computedAt
        },
        privacy: {
          privacy_tier: "node_private",
          export_policy: "local_only",
          contains_identifiers: true,
          contains_content: false,
          declaration:
            "Raw node-local fact with session/run identifiers; retained for local audit and distillation only."
        },
        evidence_refs: evidenceRefs,
        metadata: {},
        computed_at: computedAt
      },
      {
        fact_id: createId("fact"),
        fact_kind: "raw_observation",
        subject: {
          subject_type: "session",
          subject_ref: session.session_id,
          subject_version: null
        },
        scenario_signature: scenarioSignature,
        metric_name: "run_count",
        metric_value: session.metrics.run_count,
        sample_size: 1,
        confidence: 0.9,
        aggregation_window: {
          window_type: "point_in_time",
          start_at: session.created_at,
          end_at: computedAt
        },
        privacy: {
          privacy_tier: "node_private",
          export_policy: "local_only",
          contains_identifiers: true,
          contains_content: false,
          declaration:
            "Raw node-local fact with session/run identifiers; retained for local audit and distillation only."
        },
        evidence_refs: evidenceRefs,
        metadata: {},
        computed_at: computedAt
      }
    ];
  }
}

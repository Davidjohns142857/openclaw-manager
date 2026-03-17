import { createId } from "../shared/ids.ts";
import { isoNow } from "../shared/time.ts";
import type { ContributionType, SkillTrace } from "../shared/types.ts";
import { FilesystemStore } from "../storage/fs-store.ts";

export interface RecordSkillTraceInput {
  session_id: string;
  run_id: string;
  skill_name: string;
  skill_version?: string | null;
  invocation_reason?: string | null;
  duration_ms: number;
  success: boolean;
  contribution_type?: ContributionType;
  downstream_effect?: string | null;
  requires_human_fix?: boolean;
  closure_contribution_score?: number;
  scenario_tags?: string[];
  metadata?: Record<string, unknown>;
}

export class SkillTraceService {
  store: FilesystemStore;

  constructor(store: FilesystemStore) {
    this.store = store;
  }

  async record(input: RecordSkillTraceInput): Promise<SkillTrace> {
    const trace: SkillTrace = {
      trace_id: createId("trace"),
      session_id: input.session_id,
      run_id: input.run_id,
      skill_name: input.skill_name,
      skill_version: input.skill_version ?? null,
      invocation_reason: input.invocation_reason ?? null,
      input_schema_hash: null,
      output_schema_hash: null,
      duration_ms: input.duration_ms,
      success: input.success,
      contribution_type: input.contribution_type ?? "supporting",
      downstream_effect: input.downstream_effect ?? null,
      requires_human_fix: input.requires_human_fix ?? false,
      closure_contribution_score: input.closure_contribution_score ?? 0,
      scenario_tags: input.scenario_tags ?? [],
      metadata: input.metadata ?? {},
      created_at: isoNow()
    };

    await this.store.appendSkillTrace(trace.session_id, trace.run_id, trace);
    return trace;
  }
}


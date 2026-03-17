import { createId } from "../shared/ids.ts";
import { assertRunOutcomeMatchesStatus, isEndedRunStatus } from "../shared/run-lifecycle.ts";
import { isoNow } from "../shared/time.ts";
import type { Run, RunOutcome, RunStatus, RunTrigger, Session } from "../shared/types.ts";
import { FilesystemStore } from "../storage/fs-store.ts";
import { EventService } from "./event-service.ts";

export class RunService {
  store: FilesystemStore;
  eventService: EventService;

  constructor(store: FilesystemStore, eventService: EventService) {
    this.store = store;
    this.eventService = eventService;
  }

  async startRun(
    session: Session,
    trigger: RunTrigger,
    options: {
      startCheckpointRef?: string | null;
    } = {}
  ): Promise<Run> {
    const startedAt = isoNow();
    const runId = createId("run");

    const run: Run = {
      run_id: runId,
      session_id: session.session_id,
      status: "accepted",
      trigger,
      planner: {
        planner_name: "default_planner",
        planner_version: "0.1.0"
      },
      execution: {
        invoked_skills: [],
        invoked_tools: [],
        start_checkpoint_ref: options.startCheckpointRef ?? session.latest_checkpoint_ref,
        recovery_checkpoint_ref: null,
        end_checkpoint_ref: null,
        events_ref: `runs/${runId}/events.jsonl`,
        skill_traces_ref: `runs/${runId}/skill_traces.jsonl`,
        artifact_refs: [],
        spool_ref: `runs/${runId}/spool.jsonl`,
        summary_ref: null
      },
      outcome: {
        result_type: null,
        summary: null,
        reason_code: null,
        human_takeover: false,
        closure_contribution: null
      },
      metrics: {
        skill_invocation_count: 0,
        tool_call_count: 0,
        error_count: 0,
        human_intervention_count: 0,
        duration_ms: null
      },
      started_at: startedAt,
      ended_at: null,
      metadata: {}
    };

    await this.store.writeRun(session.session_id, run);
    await this.eventService.record({
      sessionId: session.session_id,
      runId: run.run_id,
      eventType: "run_accepted",
      payload: {
        trigger_type: trigger.trigger_type
      }
    });

    return this.transitionRun(session.session_id, run.run_id, "running");
  }

  async transitionRun(
    sessionId: string,
    runId: string,
    status: RunStatus,
    outcomePatch: Partial<RunOutcome> = {}
  ): Promise<Run> {
    const run = await this.store.readRun(sessionId, runId);

    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const endedAt = isEndedRunStatus(status) ? isoNow() : null;
    const nextRun: Run = {
      ...run,
      status,
      outcome: {
        ...run.outcome,
        ...outcomePatch
      },
      ended_at: endedAt,
      metrics: {
        ...run.metrics,
        duration_ms: endedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(run.started_at)) : null
      }
    };

    if (isEndedRunStatus(status)) {
      assertRunOutcomeMatchesStatus(status, nextRun.outcome);
    }

    await this.store.writeRun(sessionId, nextRun);

    const eventType =
      status === "running"
        ? "run_started"
        :
      status === "completed"
        ? "run_completed"
        : status === "failed"
          ? "run_failed"
          : status === "cancelled"
            ? "run_cancelled"
            : "run_status_changed";

    await this.eventService.record({
      sessionId,
      runId,
      eventType,
      payload: {
        status,
        result_type: nextRun.outcome.result_type,
        summary: nextRun.outcome.summary,
        reason_code: nextRun.outcome.reason_code
      }
    });

    return nextRun;
  }

  async appendSpool(sessionId: string, runId: string, payload: unknown): Promise<Run> {
    await this.store.appendSpoolLine(sessionId, runId, payload);
    return this.requireRun(sessionId, runId);
  }

  async recordSkillInvocation(sessionId: string, runId: string, skillName: string): Promise<Run> {
    return this.updateRun(sessionId, runId, (run) => ({
      ...run,
      execution: {
        ...run.execution,
        invoked_skills: appendUnique(run.execution.invoked_skills, skillName)
      },
      metrics: {
        ...run.metrics,
        skill_invocation_count: run.metrics.skill_invocation_count + 1
      }
    }));
  }

  async recordToolCall(sessionId: string, runId: string, toolName: string): Promise<Run> {
    return this.updateRun(sessionId, runId, (run) => ({
      ...run,
      execution: {
        ...run.execution,
        invoked_tools: appendUnique(run.execution.invoked_tools, toolName)
      },
      metrics: {
        ...run.metrics,
        tool_call_count: run.metrics.tool_call_count + 1
      }
    }));
  }

  async recordArtifactRef(sessionId: string, runId: string, artifactRef: string): Promise<Run> {
    return this.updateRun(sessionId, runId, (run) => ({
      ...run,
      execution: {
        ...run.execution,
        artifact_refs: appendUnique(run.execution.artifact_refs, artifactRef)
      }
    }));
  }

  async syncCommittedRecoveryRefs(
    sessionId: string,
    runId: string,
    input: {
      checkpointRef: string;
      summaryRef: string;
      markAsTerminal: boolean;
    }
  ): Promise<Run> {
    return this.updateRun(sessionId, runId, (run) => ({
      ...run,
      execution: {
        ...run.execution,
        recovery_checkpoint_ref: input.checkpointRef,
        end_checkpoint_ref: input.markAsTerminal ? input.checkpointRef : run.execution.end_checkpoint_ref,
        summary_ref: input.summaryRef
      }
    }));
  }

  private async requireRun(sessionId: string, runId: string): Promise<Run> {
    const run = await this.store.readRun(sessionId, runId);

    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    return run;
  }

  private async updateRun(
    sessionId: string,
    runId: string,
    updater: (run: Run) => Run
  ): Promise<Run> {
    const run = await this.requireRun(sessionId, runId);
    const nextRun = updater(run);
    await this.store.writeRun(sessionId, nextRun);
    return nextRun;
  }
}

function appendUnique(values: string[], nextValue: string): string[] {
  return values.includes(nextValue) ? values : [...values, nextValue];
}

import { createId } from "../shared/ids.ts";
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

  async startRun(session: Session, trigger: RunTrigger): Promise<Run> {
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
        start_checkpoint_ref: session.latest_checkpoint_ref,
        end_checkpoint_ref: null,
        artifact_refs: [],
        spool_ref: `runs/${runId}/spool.jsonl`
      },
      outcome: {
        result_type: null,
        summary: null,
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

    const endedAt = ["running", "accepted", "queued"].includes(status) ? null : isoNow();
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
        summary: nextRun.outcome.summary
      }
    });

    return nextRun;
  }
}

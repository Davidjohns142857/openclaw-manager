import { deriveSessionActivity } from "../shared/activity.ts";
import { deriveSessionStatusReason } from "../shared/session-status.ts";
import type {
  RunStatusFlowEntry,
  RunTimelineView,
  SessionTimelineSummary,
  SessionTimelineView
} from "../shared/contracts.ts";
import type { Checkpoint, Event, Run, RunStatus, Session } from "../shared/types.ts";
import { isoNow } from "../shared/time.ts";
import { FilesystemStore } from "../storage/fs-store.ts";

const statusEventTypes = new Set<string>([
  "run_accepted",
  "run_started",
  "run_status_changed",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "run_superseded"
] as const);

const runStatuses = new Set<RunStatus>([
  "accepted",
  "queued",
  "running",
  "waiting_human",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "superseded"
]);

export class TimelineService {
  store: FilesystemStore;

  constructor(store: FilesystemStore) {
    this.store = store;
  }

  async buildSessionTimeline(
    session: Session,
    currentRun: Run | null,
    runs: Run[]
  ): Promise<SessionTimelineView> {
    const orderedRuns = [...runs].sort((left, right) => left.started_at.localeCompare(right.started_at));
    const statusReason = deriveSessionStatusReason(session, currentRun);
    const sessionSummary: SessionTimelineSummary = {
      session_id: session.session_id,
      title: session.title,
      objective: session.objective,
      status: statusReason.status,
      status_reason: statusReason,
      active_run_id: session.active_run_id,
      latest_checkpoint_ref: session.latest_checkpoint_ref,
      latest_summary_ref: session.latest_summary_ref,
      activity: deriveSessionActivity(session, currentRun)
    };

    const timelineRuns = await Promise.all(
      orderedRuns.map((run) => this.buildRunTimeline(session.session_id, run))
    );

    return {
      contract_id: "session_run_timeline_v1",
      generated_at: isoNow(),
      session: sessionSummary,
      run_count: timelineRuns.length,
      runs: timelineRuns
    };
  }

  private async buildRunTimeline(sessionId: string, run: Run): Promise<RunTimelineView> {
    const [events, checkpoint, traces, spoolLines] = await Promise.all([
      this.store.readRunEvents(sessionId, run.run_id),
      this.store.readCheckpoint(sessionId, run.run_id),
      this.store.readSkillTraces(sessionId, run.run_id),
      this.store.readSpoolLines(sessionId, run.run_id)
    ]);

    return {
      run_id: run.run_id,
      status: run.status,
      started_at: run.started_at,
      ended_at: run.ended_at,
      trigger: run.trigger,
      planner: run.planner,
      outcome: run.outcome,
      status_flow: buildStatusFlow(events, run),
      recovery: {
        recovery_checkpoint_ref: run.execution.recovery_checkpoint_ref,
        end_checkpoint_ref: run.execution.end_checkpoint_ref,
        summary_ref: run.execution.summary_ref,
        committed_checkpoint_available: checkpoint !== null,
        terminal_head_advanced: run.execution.end_checkpoint_ref !== null,
        checkpoint_created_at: checkpoint?.created_at ?? null,
        checkpoint_session_status: checkpoint?.session_status ?? null,
        checkpoint_phase: checkpoint?.phase ?? null,
        blocker_count: checkpoint?.blockers.length ?? 0,
        pending_human_decision_count: checkpoint?.pending_human_decisions.length ?? 0,
        pending_external_input_count: checkpoint?.pending_external_inputs.length ?? 0,
        next_machine_actions: checkpoint?.next_machine_actions ?? [],
        next_human_actions: checkpoint?.next_human_actions ?? [],
        artifact_refs: checkpoint?.artifact_refs ?? []
      },
      evidence: {
        events_ref: run.execution.events_ref,
        event_count: events.length,
        skill_traces_ref: run.execution.skill_traces_ref,
        skill_trace_count: traces.length,
        spool_ref: run.execution.spool_ref,
        spool_line_count: spoolLines.length,
        artifact_refs: run.execution.artifact_refs,
        invoked_skills: run.execution.invoked_skills,
        invoked_tools: run.execution.invoked_tools
      }
    };
  }
}

function buildStatusFlow(events: Event[], run: Run): RunStatusFlowEntry[] {
  const flow = events
    .filter((event) => statusEventTypes.has(event.event_type))
    .map((event) => ({
      event_id: event.event_id,
      event_type: event.event_type,
      timestamp: event.timestamp,
      status: deriveStatusFromEvent(event),
      summary: asNullableString(event.payload?.summary),
      reason_code: asNullableString(event.payload?.reason_code)
    }));

  if (flow.length > 0) {
    return flow;
  }

  return [
    {
      event_id: `derived-${run.run_id}`,
      event_type: "run_status_changed",
      timestamp: run.ended_at ?? run.started_at,
      status: run.status,
      summary: run.outcome.summary,
      reason_code: run.outcome.reason_code
    }
  ];
}

function deriveStatusFromEvent(event: Event): RunStatus | null {
  switch (event.event_type) {
    case "run_accepted":
      return "accepted";
    case "run_started":
      return "running";
    case "run_completed":
      return "completed";
    case "run_failed":
      return "failed";
    case "run_cancelled":
      return "cancelled";
    case "run_superseded":
      return "superseded";
    case "run_status_changed":
      return asRunStatus(event.payload?.status);
    default:
      return null;
  }
}

function asRunStatus(value: unknown): RunStatus | null {
  return typeof value === "string" && runStatuses.has(value as RunStatus)
    ? (value as RunStatus)
    : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

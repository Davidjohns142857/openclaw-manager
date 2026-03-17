import { readFile } from "node:fs/promises";
import path from "node:path";

import { deriveSessionStatusReason } from "../shared/session-status.ts";
import type { Checkpoint, ManagerConfig, Run, Session } from "../shared/types.ts";
import { isoNow } from "../shared/time.ts";
import { renderTemplate } from "../shared/template.ts";
import { FilesystemStore } from "../storage/fs-store.ts";
import { EventService } from "./event-service.ts";

function formatList(items: string[], emptyLabel: string = "- None"): string {
  if (items.length === 0) {
    return emptyLabel;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export class CheckpointService {
  config: ManagerConfig;
  store: FilesystemStore;
  eventService: EventService;

  constructor(config: ManagerConfig, store: FilesystemStore, eventService: EventService) {
    this.config = config;
    this.store = store;
    this.eventService = eventService;
  }

  buildCheckpoint(session: Session, run: Run): Checkpoint {
    const statusReason = deriveSessionStatusReason(session, run);

    return {
      session_id: session.session_id,
      run_id: run.run_id,
      session_status: statusReason.status,
      phase: session.state.phase,
      blockers: session.state.blockers,
      pending_human_decisions: session.state.pending_human_decisions,
      pending_external_inputs: session.state.pending_external_inputs,
      artifact_refs: run.execution.artifact_refs,
      next_machine_actions: session.state.next_machine_actions,
      next_human_actions: session.state.next_human_actions,
      active_assumptions: Array.isArray(session.metadata.assumptions)
        ? session.metadata.assumptions.filter((value): value is string => typeof value === "string")
        : [],
      metadata: {
        planner: run.planner.planner_name,
        status_source_kind: statusReason.source_kind,
        status_source_run_id: statusReason.source_run_id,
        status_source_run_status: statusReason.source_run_status,
        status_source_decision_id: statusReason.source_decision_id,
        status_source_blocker_id: statusReason.source_blocker_id
      },
      created_at: isoNow()
    };
  }

  applyCheckpoint(session: Session, checkpoint: Checkpoint): Session {
    return {
      ...session,
      status: checkpoint.session_status,
      state: {
        ...session.state,
        phase: checkpoint.phase,
        blockers: checkpoint.blockers,
        pending_human_decisions: checkpoint.pending_human_decisions,
        pending_external_inputs: checkpoint.pending_external_inputs,
        next_machine_actions: checkpoint.next_machine_actions,
        next_human_actions: checkpoint.next_human_actions
      }
    };
  }

  async renderSummary(
    session: Session,
    run: Run,
    checkpoint: Checkpoint,
    notes: string[] = []
  ): Promise<string> {
    const templatePath = path.join(this.config.templatesDir, "session-summary.md");
    const template = await readFile(templatePath, "utf8");

    const blockerLines = session.state.blockers.map(
      (blocker) => `[${blocker.severity}] ${blocker.summary}`
    );
    const decisionLines = session.state.pending_human_decisions.map(
      (decision) => `[${decision.urgency}] ${decision.summary}`
    );
    const noteLines = [...notes];

    if (run.outcome.summary) {
      noteLines.push(run.outcome.summary);
    }

    if (checkpoint.active_assumptions.length > 0) {
      noteLines.push(`Active assumptions: ${checkpoint.active_assumptions.join(", ")}`);
    }

    return renderTemplate(template, {
      title: session.title,
      objective: session.objective,
      status: session.status,
      lifecycle_stage: session.lifecycle_stage,
      phase: session.state.phase,
      goal_status: session.state.goal_status,
      active_run: run.run_id,
      last_activity: session.metrics.last_activity_at,
      blockers: formatList(blockerLines),
      pending_human_decisions: formatList(decisionLines),
      next_machine_actions: formatList(session.state.next_machine_actions),
      next_human_actions: formatList(session.state.next_human_actions),
      notes: formatList(noteLines)
    });
  }

  async refreshRecoveryArtifacts(
    session: Session,
    run: Run,
    notes: string[] = []
  ): Promise<{ checkpoint: Checkpoint; summary: string }> {
    const checkpoint = this.buildCheckpoint(session, run);
    const summary = await this.renderSummary(session, run, checkpoint, notes);
    const committedCheckpoint = await this.store.writeRecoveryArtifacts(
      session.session_id,
      run.run_id,
      checkpoint,
      summary
    );

    await this.eventService.record({
      sessionId: session.session_id,
      runId: run.run_id,
      eventType: "checkpoint_written",
      payload: {
        checkpoint_ref: `runs/${run.run_id}/checkpoint.json`
      }
    });
    await this.eventService.record({
      sessionId: session.session_id,
      runId: run.run_id,
      eventType: "summary_refreshed",
      payload: {
        summary_ref: "summary.md"
      }
    });

    return { checkpoint: committedCheckpoint, summary };
  }
}

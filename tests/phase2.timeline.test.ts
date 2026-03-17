import assert from "node:assert/strict";
import { test } from "node:test";

import { ManagerServer } from "../src/api/server.ts";
import { createTempManager, dispatchRoute } from "./helpers.ts";

test("timeline route exports runs, triggers, status flow, outcome, and recovery/evidence refs", async () => {
  const manager = await createTempManager();

  try {
    const server = new ManagerServer(manager.controlPlane, manager.config);
    const adopted = await manager.controlPlane.adoptSession({
      title: "Timeline evidence contract",
      objective: "Explain what each run did and how it ended."
    });

    let session = await manager.controlPlane.sessionService.requireSession(adopted.session.session_id);
    session.state.phase = "research_pass_1";
    session.state.next_machine_actions = ["Draft the synthesis memo."];
    session = await manager.controlPlane.sessionService.saveSession(session);
    await manager.controlPlane.refreshCheckpoint(adopted.session.session_id);

    await manager.controlPlane.runService.recordSkillInvocation(
      adopted.session.session_id,
      adopted.run.run_id,
      "research-skill"
    );
    await manager.controlPlane.runService.recordToolCall(
      adopted.session.session_id,
      adopted.run.run_id,
      "web.fetch"
    );
    await manager.controlPlane.runService.recordArtifactRef(
      adopted.session.session_id,
      adopted.run.run_id,
      "artifacts/research-notes.md"
    );
    await manager.controlPlane.runService.appendSpool(
      adopted.session.session_id,
      adopted.run.run_id,
      { step: "fetch", ok: true }
    );
    await manager.controlPlane.skillTraceService.record({
      session_id: adopted.session.session_id,
      run_id: adopted.run.run_id,
      skill_name: "research-skill",
      duration_ms: 250,
      success: true
    });

    const settledManual = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "completed",
      summary: "Initial research pass completed.",
      reason_code: "segment_complete"
    });

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.ok(resumed.run);

    session = await manager.controlPlane.sessionService.requireSession(adopted.session.session_id);
    session.state.phase = "human_review";
    session = await manager.controlPlane.sessionService.saveSession(session);

    const settledResume = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "waiting_human",
      summary: "Need approval before sending the final answer.",
      reason_code: "human_approval_required",
      pending_human_decisions: [
        {
          decision_id: "dec_timeline_001",
          summary: "Approve whether to send the final write-up.",
          requested_at: "2026-03-17T00:00:00.000Z",
          urgency: "high"
        }
      ],
      next_human_actions: ["Approve or reject the final response."]
    });

    const response = await dispatchRoute(
      server,
      "GET",
      `/sessions/${adopted.session.session_id}/timeline`
    );

    assert.equal(response.statusCode, 200);
    const timeline = response.body as {
      contract_id: string;
      session: {
        session_id: string;
        status_reason: { source_kind: string; source_run_id: string | null };
        activity: { run: { state: string; phase: string } };
        latest_checkpoint_ref: string | null;
      };
      run_count: number;
      runs: Array<{
        run_id: string;
        trigger: { trigger_type: string };
        status: string;
        status_flow: Array<{ status: string | null }>;
        outcome: { summary: string | null; reason_code: string | null };
        recovery: {
          terminal_head_advanced: boolean;
          committed_checkpoint_available: boolean;
          checkpoint_phase: string | null;
          checkpoint_session_status: string | null;
          pending_human_decision_count: number;
        };
        evidence: {
          event_count: number;
          skill_trace_count: number;
          spool_line_count: number;
          artifact_refs: string[];
          invoked_skills: string[];
          invoked_tools: string[];
        };
      }>;
    };

    assert.equal(timeline.contract_id, "session_run_timeline_v1");
    assert.equal(timeline.session.session_id, adopted.session.session_id);
    assert.equal(timeline.session.status_reason.source_kind, "paused_run");
    assert.equal(timeline.session.status_reason.source_run_id, settledResume.run.run_id);
    assert.equal(timeline.session.activity.run.state, "idle");
    assert.equal(timeline.session.activity.run.phase, "waiting_human");
    assert.equal(timeline.session.latest_checkpoint_ref, `runs/${settledResume.run.run_id}/checkpoint.json`);
    assert.equal(timeline.run_count, 2);

    const [manualRun, resumeRun] = timeline.runs;
    assert.equal(manualRun?.run_id, settledManual.run.run_id);
    assert.equal(manualRun?.trigger.trigger_type, "manual");
    assert.equal(manualRun?.status, "completed");
    assert.deepEqual(
      manualRun?.status_flow.map((entry) => entry.status),
      ["accepted", "running", "completed"]
    );
    assert.equal(manualRun?.outcome.summary, "Initial research pass completed.");
    assert.equal(manualRun?.outcome.reason_code, "segment_complete");
    assert.equal(manualRun?.recovery.terminal_head_advanced, true);
    assert.equal(manualRun?.recovery.committed_checkpoint_available, true);
    assert.equal(manualRun?.recovery.checkpoint_phase, "research_pass_1");
    assert.equal(manualRun?.recovery.checkpoint_session_status, "active");
    assert.ok((manualRun?.evidence.event_count ?? 0) >= 3);
    assert.equal(manualRun?.evidence.skill_trace_count, 1);
    assert.equal(manualRun?.evidence.spool_line_count, 1);
    assert.deepEqual(manualRun?.evidence.artifact_refs, ["artifacts/research-notes.md"]);
    assert.deepEqual(manualRun?.evidence.invoked_skills, ["research-skill"]);
    assert.deepEqual(manualRun?.evidence.invoked_tools, ["web.fetch"]);

    assert.equal(resumeRun?.run_id, settledResume.run.run_id);
    assert.equal(resumeRun?.trigger.trigger_type, "resume");
    assert.equal(resumeRun?.status, "waiting_human");
    assert.deepEqual(
      resumeRun?.status_flow.map((entry) => entry.status),
      ["accepted", "running", "waiting_human"]
    );
    assert.equal(resumeRun?.outcome.summary, "Need approval before sending the final answer.");
    assert.equal(resumeRun?.outcome.reason_code, "human_approval_required");
    assert.equal(resumeRun?.recovery.terminal_head_advanced, true);
    assert.equal(resumeRun?.recovery.committed_checkpoint_available, true);
    assert.equal(resumeRun?.recovery.checkpoint_phase, "human_review");
    assert.equal(resumeRun?.recovery.checkpoint_session_status, "waiting_human");
    assert.equal(resumeRun?.recovery.pending_human_decision_count, 1);
  } finally {
    await manager.cleanup();
  }
});

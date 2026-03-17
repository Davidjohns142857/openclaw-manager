import assert from "node:assert/strict";
import { test } from "node:test";

import { createTempManager, pathExists, readJsonl, sessionPaths } from "./helpers.ts";

test("waiting_human run settlement keeps recovery authoritative while preserving queued inbound focus", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Paused run semantics",
      objective: "Verify waiting_human is a real run-ending state."
    });

    const settled = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "waiting_human",
      summary: "Need explicit user approval before continuing.",
      reason_code: "human_decision_required",
      pending_human_decisions: [
        {
          decision_id: "dec_run_pause_001",
          summary: "Approve the next execution step.",
          requested_at: "2026-03-17T00:00:00.000Z",
          urgency: "high"
        }
      ],
      next_human_actions: ["Approve or reject the proposed plan."]
    });

    assert.equal(settled.run.status, "waiting_human");
    assert.equal(settled.run.outcome.result_type, "waiting_human");
    assert.equal(settled.run.outcome.closure_contribution, null);
    assert.equal(settled.run.outcome.human_takeover, true);
    assert.ok(settled.run.ended_at);
    assert.equal(settled.recovery_head_advanced, true);
    assert.ok(settled.checkpoint);
    assert.equal(settled.run.execution.end_checkpoint_ref, `runs/${settled.run.run_id}/checkpoint.json`);
    assert.equal(settled.run.execution.recovery_checkpoint_ref, `runs/${settled.run.run_id}/checkpoint.json`);
    assert.equal(settled.run.execution.summary_ref, "summary.md");
    assert.equal(settled.session.status, "waiting_human");
    assert.equal(settled.session.active_run_id, null);

    const inbound = await manager.controlPlane.handleInboundMessage({
      request_id: "req_waiting_run_001",
      source_type: "github",
      source_thread_key: "issue_waiting_run_001",
      target_session_id: adopted.session.session_id,
      message_type: "user_message",
      content: "Extra context arrived while waiting for human approval."
    });

    assert.equal(inbound.queued, true);
    assert.equal(inbound.run_started, false);
    assert.equal(inbound.session.status, "waiting_human");
    assert.deepEqual(inbound.session.state.pending_external_inputs, ["req_waiting_run_001"]);

    const focus = await manager.controlPlane.focus();
    const item = focus.find((entry) => entry.session_id === adopted.session.session_id);
    assert.ok(item);
    assert.equal(item?.category, "waiting_human");
    assert.deepEqual(item?.metadata.merged_categories, [
      "waiting_human",
      "desynced",
      "summary_drift"
    ]);

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.equal(resumed.run?.run_id, settled.run.run_id);
    assert.equal(resumed.run?.status, "waiting_human");
    assert.equal(resumed.session.status, "waiting_human");
    assert.deepEqual(resumed.session.state.pending_external_inputs, ["req_waiting_run_001"]);
    assert.equal(resumed.session.metadata.pending_inbound_count, 1);
  } finally {
    await manager.cleanup();
  }
});

test("blocked run settlement keeps recovery authoritative while preserving queued inbound focus", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Blocked run semantics",
      objective: "Verify blocked is distinct from failed and is recovery-relevant."
    });

    const settled = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "blocked",
      summary: "Blocked on an upstream dependency.",
      reason_code: "external_dependency",
      blockers: [
        {
          blocker_id: "blk_run_blocked_001",
          type: "external_dependency",
          summary: "Waiting for partner API access.",
          detected_at: "2026-03-17T00:00:00.000Z",
          severity: "high"
        }
      ],
      next_human_actions: ["Decide whether to wait, retry, or narrow scope."]
    });

    assert.equal(settled.run.status, "blocked");
    assert.equal(settled.run.outcome.result_type, "blocked");
    assert.equal(settled.run.outcome.closure_contribution, null);
    assert.equal(settled.run.outcome.human_takeover, false);
    assert.equal(settled.recovery_head_advanced, true);
    assert.ok(settled.checkpoint);
    assert.equal(settled.session.status, "blocked");
    assert.equal(settled.session.active_run_id, null);

    const inbound = await manager.controlPlane.handleInboundMessage({
      request_id: "req_blocked_run_001",
      source_type: "github",
      source_thread_key: "issue_blocked_run_001",
      target_session_id: adopted.session.session_id,
      message_type: "user_message",
      content: "The upstream dependency still has not cleared."
    });

    assert.equal(inbound.queued, true);
    assert.equal(inbound.run_started, false);
    assert.equal(inbound.session.status, "blocked");
    assert.deepEqual(inbound.session.state.pending_external_inputs, ["req_blocked_run_001"]);

    const focus = await manager.controlPlane.focus();
    const item = focus.find((entry) => entry.session_id === adopted.session.session_id);
    assert.ok(item);
    assert.equal(item?.category, "blocked");
    assert.deepEqual(item?.metadata.merged_categories, ["blocked", "desynced", "summary_drift"]);

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.equal(resumed.run?.run_id, settled.run.run_id);
    assert.equal(resumed.run?.status, "blocked");
    assert.equal(resumed.session.status, "blocked");
    assert.deepEqual(resumed.session.state.pending_external_inputs, ["req_blocked_run_001"]);
    assert.equal(resumed.session.metadata.pending_inbound_count, 1);
  } finally {
    await manager.cleanup();
  }
});

test("completed run advances recovery head, stays quiet in focus, and seeds the next resume run", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Completed run semantics",
      objective: "Verify completed runs feed recovery and stay quiet in focus."
    });
    let session = await manager.controlPlane.sessionService.requireSession(
      adopted.session.session_id
    );
    session.state.phase = "completion_base";
    session.state.next_machine_actions = ["Publish the completed artifact."];
    session = await manager.controlPlane.sessionService.saveSession(session);

    await manager.controlPlane.refreshCheckpoint(adopted.session.session_id);

    const settled = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "completed",
      summary: "The first execution slice completed successfully.",
      reason_code: "task_segment_finished"
    });

    assert.equal(settled.run.status, "completed");
    assert.equal(settled.run.outcome.result_type, "completed");
    assert.equal(settled.run.outcome.closure_contribution, 1);
    assert.equal(settled.recovery_head_advanced, true);
    assert.equal(settled.session.status, "active");
    assert.equal(settled.session.active_run_id, null);

    const focus = await manager.controlPlane.focus();
    assert.equal(
      focus.some((entry) => entry.session_id === adopted.session.session_id),
      false
    );

    session = await manager.controlPlane.sessionService.requireSession(adopted.session.session_id);
    session.state.phase = "mutated_after_completed_checkpoint";
    await manager.controlPlane.sessionService.saveSession(session);

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.ok(resumed.run);
    assert.notEqual(resumed.run?.run_id, settled.run.run_id);
    assert.equal(resumed.run?.trigger.trigger_type, "resume");
    assert.equal(
      resumed.run?.execution.start_checkpoint_ref,
      `runs/${settled.run.run_id}/checkpoint.json`
    );
    assert.equal(resumed.session.state.phase, "completion_base");
    assert.equal(resumed.session.active_run_id, resumed.run?.run_id ?? null);
  } finally {
    await manager.cleanup();
  }
});

test("failed run stays resumable, restores committed checkpoint state, and escalates focus after repeated failures", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Failed run semantics",
      objective: "Verify failed runs do not overwrite committed recovery state."
    });
    let session = await manager.controlPlane.sessionService.requireSession(
      adopted.session.session_id
    );
    session.state.phase = "failed_checkpoint_base";
    session = await manager.controlPlane.sessionService.saveSession(session);
    await manager.controlPlane.refreshCheckpoint(adopted.session.session_id);
    const originalCheckpointRef = (
      await manager.controlPlane.sessionService.requireSession(adopted.session.session_id)
    ).latest_checkpoint_ref;

    const settled = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "failed",
      summary: "The tool chain crashed before completing the task.",
      reason_code: "tool_error",
      next_machine_actions: ["Retry the tool chain after inspecting logs."]
    });

    assert.equal(settled.run.status, "failed");
    assert.equal(settled.run.outcome.result_type, "failed");
    assert.equal(settled.run.outcome.closure_contribution, null);
    assert.equal(settled.recovery_head_advanced, false);
    assert.equal(settled.checkpoint, null);
    assert.equal(settled.run.execution.end_checkpoint_ref, null);
    assert.equal(settled.session.status, "active");
    assert.equal(settled.session.metrics.failed_run_count, 1);
    assert.equal(settled.session.latest_checkpoint_ref, originalCheckpointRef);

    let focus = await manager.controlPlane.focus();
    let item = focus.find((entry) => entry.session_id === adopted.session.session_id);
    assert.ok(item);
    assert.equal(item?.category, "summary_drift");

    session = await manager.controlPlane.sessionService.requireSession(adopted.session.session_id);
    session.state.phase = "mutated_after_failed_run";
    session = await manager.controlPlane.sessionService.saveSession(session);

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.ok(resumed.run);
    assert.notEqual(resumed.run?.run_id, settled.run.run_id);
    assert.equal(resumed.run?.trigger.trigger_type, "resume");
    assert.equal(resumed.run?.execution.start_checkpoint_ref, originalCheckpointRef);
    assert.equal(resumed.session.state.phase, "failed_checkpoint_base");
    assert.equal(resumed.session.active_run_id, resumed.run?.run_id ?? null);

    const settledAgain = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "failed",
      summary: "The second retry failed too.",
      reason_code: "tool_error"
    });

    assert.equal(settledAgain.session.metrics.failed_run_count, 2);
    assert.equal(settledAgain.session.status, "active");

    focus = await manager.controlPlane.focus();
    item = focus.find((entry) => entry.session_id === adopted.session.session_id);
    assert.ok(item);
    assert.equal(item?.category, "blocked");
    assert.deepEqual(item?.metadata.merged_categories, ["blocked", "summary_drift"]);
  } finally {
    await manager.cleanup();
  }
});

for (const status of ["cancelled", "superseded"] as const) {
  test(`${status} run keeps the committed checkpoint for recovery and only raises summary drift in focus`, async () => {
    const manager = await createTempManager();

    try {
      const adopted = await manager.controlPlane.adoptSession({
        title: `${status} run semantics`,
        objective: `Verify ${status} keeps recovery on the committed checkpoint.`
      });
      let session = await manager.controlPlane.sessionService.requireSession(
        adopted.session.session_id
      );
      session.state.phase = `${status}_checkpoint_base`;
      session = await manager.controlPlane.sessionService.saveSession(session);
      await manager.controlPlane.refreshCheckpoint(adopted.session.session_id);

      const settled = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
        status,
        summary: `The run ended as ${status}.`,
        reason_code: `${status}_by_control_plane`
      });

      assert.equal(settled.run.status, status);
      assert.equal(settled.run.outcome.result_type, null);
      assert.equal(settled.run.outcome.reason_code, `${status}_by_control_plane`);
      assert.equal(settled.run.outcome.closure_contribution, null);
      assert.equal(settled.recovery_head_advanced, false);
      assert.equal(settled.checkpoint, null);
      assert.equal(settled.run.execution.end_checkpoint_ref, null);
      assert.equal(settled.session.status, "active");
      assert.equal(settled.session.active_run_id, null);

      const paths = sessionPaths(
        manager.tempRoot,
        adopted.session.session_id,
        settled.run.run_id
      );
      const runEvents = await readJsonl<{ event_type: string }>(paths.events);
      assert.equal(
        runEvents.some(
          (event) =>
            event.event_type === (status === "cancelled" ? "run_cancelled" : "run_superseded")
        ),
        true
      );

      const detail = await manager.controlPlane.getSessionDetail(adopted.session.session_id);
      assert.ok(detail.checkpoint);
      assert.equal(detail.checkpoint?.phase, `${status}_checkpoint_base`);

      const focus = await manager.controlPlane.focus();
      const item = focus.find((entry) => entry.session_id === adopted.session.session_id);
      assert.ok(item);
      assert.equal(item?.category, "summary_drift");
      assert.deepEqual(item?.metadata.merged_categories, ["summary_drift"]);

      session = await manager.controlPlane.sessionService.requireSession(adopted.session.session_id);
      session.state.phase = `${status}_mutated_after_settlement`;
      session = await manager.controlPlane.sessionService.saveSession(session);

      const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
      assert.ok(resumed.run);
      assert.notEqual(resumed.run?.run_id, settled.run.run_id);
      assert.equal(resumed.run?.trigger.trigger_type, "resume");
      assert.equal(
        resumed.run?.execution.start_checkpoint_ref,
        `runs/${settled.run.run_id}/checkpoint.json`
      );
      assert.equal(resumed.session.state.phase, `${status}_checkpoint_base`);
    } finally {
      await manager.cleanup();
    }
  });
}

test("settled run rejects invalid status/result_type combinations", async () => {
  const manager = await createTempManager();

  try {
    const invalidCases = [
      {
        status: "completed",
        result_type: "failed",
        reason_code: "invalid_completed_failed"
      },
      {
        status: "waiting_human",
        result_type: "blocked",
        reason_code: "invalid_waiting_blocked"
      },
      {
        status: "failed",
        result_type: "completed",
        reason_code: "invalid_failed_completed"
      },
      {
        status: "cancelled",
        result_type: "no_op",
        reason_code: "invalid_cancelled_noop"
      },
      {
        status: "cancelled",
        result_type: null,
        reason_code: undefined
      }
    ] as const;

    for (const [index, invalidCase] of invalidCases.entries()) {
      const adopted = await manager.controlPlane.adoptSession({
        title: `Invalid run outcome ${index}`,
        objective: "Reject invalid status/outcome combinations."
      });

      await assert.rejects(
        manager.controlPlane.settleActiveRun(adopted.session.session_id, {
          status: invalidCase.status,
          result_type: invalidCase.result_type as never,
          summary: "Invalid combination should be rejected.",
          reason_code: invalidCase.reason_code
        }),
        /cannot use outcome\.result_type|must set outcome\.reason_code/
      );
    }
  } finally {
    await manager.cleanup();
  }
});

test("transitionRun rejects illegal terminal-to-running rewinds", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Illegal transition guard",
      objective: "Completed runs must not transition back into running."
    });

    const settled = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "completed",
      summary: "This run is done.",
      reason_code: "completed_for_guard_test"
    });

    await assert.rejects(
      manager.controlPlane.runService.transitionRun(
        adopted.session.session_id,
        settled.run.run_id,
        "running"
      ),
      /Illegal run transition: completed -> running/
    );
  } finally {
    await manager.cleanup();
  }
});

for (const outcomeCase of [
  {
    result_type: "partial_progress" as const,
    expected_contribution: 0.5
  },
  {
    result_type: "no_op" as const,
    expected_contribution: 0
  }
]) {
  test(`completed run accepts ${outcomeCase.result_type} and keeps recovery/focus semantics stable`, async () => {
    const manager = await createTempManager();

    try {
      const adopted = await manager.controlPlane.adoptSession({
        title: `Completed ${outcomeCase.result_type}`,
        objective: "Verify completed status can carry semantic outcomes safely."
      });

      const settled = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
        status: "completed",
        result_type: outcomeCase.result_type,
        summary: `Run ended with ${outcomeCase.result_type}.`,
        reason_code: `completed_${outcomeCase.result_type}`
      });

      assert.equal(settled.run.status, "completed");
      assert.equal(settled.run.outcome.result_type, outcomeCase.result_type);
      assert.equal(
        settled.run.outcome.closure_contribution,
        outcomeCase.expected_contribution
      );
      assert.equal(settled.recovery_head_advanced, true);
      assert.equal(settled.run.execution.end_checkpoint_ref, `runs/${settled.run.run_id}/checkpoint.json`);
      assert.equal(settled.session.status, "active");
      assert.equal(settled.session.active_run_id, null);

      const focus = await manager.controlPlane.focus();
      assert.equal(
        focus.some((entry) => entry.session_id === adopted.session.session_id),
        false
      );
    } finally {
      await manager.cleanup();
    }
  });
}

test("resume prefers the latest terminal recovery head over a newer failed run checkpoint", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Terminal head precedence",
      objective: "Failed runs should not steal the next resume checkpoint."
    });
    let session = await manager.controlPlane.sessionService.requireSession(
      adopted.session.session_id
    );
    session.state.phase = "phase_from_terminal_head";
    session = await manager.controlPlane.sessionService.saveSession(session);
    await manager.controlPlane.refreshCheckpoint(adopted.session.session_id);

    const completed = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "completed",
      summary: "The baseline execution completed cleanly.",
      reason_code: "baseline_completed"
    });

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.ok(resumed.run);
    const failedRunId = resumed.run!.run_id;
    assert.equal(
      resumed.run?.execution.start_checkpoint_ref,
      `runs/${completed.run.run_id}/checkpoint.json`
    );

    session = await manager.controlPlane.sessionService.requireSession(adopted.session.session_id);
    session.state.phase = "mutated_in_failed_followup_run";
    session = await manager.controlPlane.sessionService.saveSession(session);

    const failed = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "failed",
      summary: "The follow-up run failed.",
      reason_code: "tool_error"
    });

    assert.equal(failed.run.run_id, failedRunId);
    assert.equal(failed.run.execution.end_checkpoint_ref, null);
    assert.equal(
      failed.run.execution.recovery_checkpoint_ref,
      `runs/${failed.run.run_id}/checkpoint.json`
    );

    const resumedAgain = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.ok(resumedAgain.run);
    assert.notEqual(resumedAgain.run?.run_id, failed.run.run_id);
    assert.equal(
      resumedAgain.run?.execution.start_checkpoint_ref,
      `runs/${completed.run.run_id}/checkpoint.json`
    );
    assert.notEqual(
      resumedAgain.run?.execution.start_checkpoint_ref,
      failed.run.execution.recovery_checkpoint_ref
    );
    assert.equal(resumedAgain.session.state.phase, "phase_from_terminal_head");
  } finally {
    await manager.cleanup();
  }
});

test("run keeps stable minimal evidence refs for events, spool, checkpoint, summary, tools, skills, and artifacts", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Run evidence refs",
      objective: "Verify minimal run evidence survives independently from session."
    });
    const run = adopted.run;

    await manager.controlPlane.runService.recordSkillInvocation(
      adopted.session.session_id,
      run.run_id,
      "research-skill"
    );
    await manager.controlPlane.runService.recordToolCall(
      adopted.session.session_id,
      run.run_id,
      "web.fetch"
    );
    await manager.controlPlane.runService.recordArtifactRef(
      adopted.session.session_id,
      run.run_id,
      "artifacts/research-notes.md"
    );
    await manager.controlPlane.runService.appendSpool(adopted.session.session_id, run.run_id, {
      step: "fetch",
      ok: true
    });

    const runOnDisk = await manager.store.readRun(adopted.session.session_id, run.run_id);
    assert.ok(runOnDisk);
    assert.equal(runOnDisk?.execution.events_ref, `runs/${run.run_id}/events.jsonl`);
    assert.equal(runOnDisk?.execution.skill_traces_ref, `runs/${run.run_id}/skill_traces.jsonl`);
    assert.equal(runOnDisk?.execution.spool_ref, `runs/${run.run_id}/spool.jsonl`);
    assert.equal(runOnDisk?.execution.recovery_checkpoint_ref, `runs/${run.run_id}/checkpoint.json`);
    assert.equal(runOnDisk?.execution.summary_ref, "summary.md");
    assert.deepEqual(runOnDisk?.execution.invoked_skills, ["research-skill"]);
    assert.deepEqual(runOnDisk?.execution.invoked_tools, ["web.fetch"]);
    assert.deepEqual(runOnDisk?.execution.artifact_refs, ["artifacts/research-notes.md"]);

    const paths = sessionPaths(manager.tempRoot, adopted.session.session_id, run.run_id);
    assert.equal(await pathExists(paths.events), true);
    assert.equal(await pathExists(paths.checkpoint), true);
    assert.equal(await pathExists(paths.summary), true);
    assert.equal(await pathExists(`${paths.runDir}/spool.jsonl`), true);
  } finally {
    await manager.cleanup();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { createTempManager, pathExists, sessionPaths } from "./helpers.ts";

test("waiting_human run settlement commits recovery head and blocks automatic resume", async () => {
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
    assert.ok(settled.run.ended_at);
    assert.equal(settled.recovery_head_advanced, true);
    assert.ok(settled.checkpoint);
    assert.equal(settled.run.execution.end_checkpoint_ref, `runs/${settled.run.run_id}/checkpoint.json`);
    assert.equal(settled.run.execution.recovery_checkpoint_ref, `runs/${settled.run.run_id}/checkpoint.json`);
    assert.equal(settled.run.execution.summary_ref, "summary.md");
    assert.equal(settled.session.status, "waiting_human");
    assert.equal(settled.session.active_run_id, null);

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.equal(resumed.run?.run_id, settled.run.run_id);
    assert.equal(resumed.run?.status, "waiting_human");
    assert.equal(resumed.session.status, "waiting_human");

    const focus = await manager.controlPlane.focus();
    const item = focus.find((entry) => entry.session_id === adopted.session.session_id);
    assert.ok(item);
    assert.equal(item?.category, "waiting_human");
  } finally {
    await manager.cleanup();
  }
});

test("blocked run settlement commits checkpoint and keeps resume from auto-continuing", async () => {
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
    assert.equal(settled.recovery_head_advanced, true);
    assert.ok(settled.checkpoint);
    assert.equal(settled.session.status, "blocked");
    assert.equal(settled.session.active_run_id, null);

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.equal(resumed.run?.run_id, settled.run.run_id);
    assert.equal(resumed.run?.status, "blocked");
    assert.equal(resumed.session.status, "blocked");

    const focus = await manager.controlPlane.focus();
    const item = focus.find((entry) => entry.session_id === adopted.session.session_id);
    assert.ok(item);
    assert.equal(item?.category, "blocked");
  } finally {
    await manager.cleanup();
  }
});

test("failed run remains distinct from blocked and does not advance recovery head", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Failed run semantics",
      objective: "Verify failed runs do not overwrite committed recovery state."
    });
    const originalCheckpointRef = adopted.session.latest_checkpoint_ref;

    const settled = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "failed",
      summary: "The tool chain crashed before completing the task.",
      reason_code: "tool_error"
    });

    assert.equal(settled.run.status, "failed");
    assert.equal(settled.recovery_head_advanced, false);
    assert.equal(settled.checkpoint, null);
    assert.equal(settled.run.execution.end_checkpoint_ref, null);
    assert.equal(settled.session.status, "active");
    assert.equal(settled.session.metrics.failed_run_count, 1);
    assert.equal(settled.session.latest_checkpoint_ref, originalCheckpointRef);

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.ok(resumed.run);
    assert.notEqual(resumed.run?.run_id, settled.run.run_id);
    assert.equal(resumed.run?.trigger.trigger_type, "resume");
    assert.equal(resumed.session.active_run_id, resumed.run?.run_id ?? null);
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

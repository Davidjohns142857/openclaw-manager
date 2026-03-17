import assert from "node:assert/strict";
import { test } from "node:test";

import { createTempManager } from "./helpers.ts";

test("waiting_human sessions queue inbound updates instead of auto-starting a run", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Decision queueing",
      objective: "Pending decisions should block auto-continue."
    });
    const session = await manager.controlPlane.sessionService.requireSession(
      adopted.session.session_id
    );

    session.active_run_id = null;
    session.state.pending_human_decisions.push({
      decision_id: "dec_waiting_001",
      summary: "Confirm whether to proceed",
      requested_at: "2026-03-16T00:00:00Z",
      urgency: "high"
    });
    await manager.controlPlane.sessionService.saveSession(session);

    const inbound = await manager.controlPlane.handleInboundMessage({
      request_id: "req_waiting_001",
      source_type: "telegram",
      source_thread_key: "thread_waiting_001",
      target_session_id: adopted.session.session_id,
      message_type: "user_message",
      content: "Here is more context."
    });

    assert.equal(inbound.queued, true);
    assert.equal(inbound.run_started, false);
    assert.equal(inbound.run, null);
    assert.equal(inbound.session.status, "waiting_human");
    assert.deepEqual(inbound.session.state.pending_external_inputs, ["req_waiting_001"]);
    assert.equal(inbound.session.metadata.pending_inbound_count, 1);
  } finally {
    await manager.cleanup();
  }
});

test("blocked sessions queue inbound updates instead of auto-starting a run", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Blocked queueing",
      objective: "Blockers should block auto-continue."
    });
    const session = await manager.controlPlane.sessionService.requireSession(
      adopted.session.session_id
    );

    session.active_run_id = null;
    session.state.blockers.push({
      blocker_id: "blk_blocked_001",
      type: "external_dependency",
      summary: "Upstream approval is still missing",
      detected_at: "2026-03-16T00:00:00Z",
      severity: "high"
    });
    await manager.controlPlane.sessionService.saveSession(session);

    const inbound = await manager.controlPlane.handleInboundMessage({
      request_id: "req_blocked_001",
      source_type: "telegram",
      source_thread_key: "thread_blocked_001",
      target_session_id: adopted.session.session_id,
      message_type: "user_message",
      content: "Approval has not landed yet."
    });

    assert.equal(inbound.queued, true);
    assert.equal(inbound.run_started, false);
    assert.equal(inbound.run, null);
    assert.equal(inbound.session.status, "blocked");
    assert.deepEqual(inbound.session.state.pending_external_inputs, ["req_blocked_001"]);
    assert.equal(inbound.session.metadata.pending_inbound_count, 1);
  } finally {
    await manager.cleanup();
  }
});

test("checkpoint restores blocker and pending decision state during resume", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Recovery of blockers and decisions",
      objective: "Checkpoint should restore blocker and human-decision state."
    });

    let session = await manager.controlPlane.sessionService.requireSession(
      adopted.session.session_id
    );
    session.state.blockers = [
      {
        blocker_id: "blk_recovery_001",
        type: "external_dependency",
        summary: "Need external sign-off",
        detected_at: "2026-03-16T00:00:00Z",
        severity: "medium"
      }
    ];
    session.state.pending_human_decisions = [
      {
        decision_id: "dec_recovery_001",
        summary: "Approve final execution scope",
        requested_at: "2026-03-16T00:00:00Z",
        urgency: "medium"
      }
    ];
    session.metadata.summary_needs_refresh = true;
    session = await manager.controlPlane.sessionService.saveSession(session);

    const refreshed = await manager.controlPlane.refreshCheckpoint(adopted.session.session_id);
    assert.equal(refreshed.checkpoint?.blockers.length, 1);
    assert.equal(refreshed.checkpoint?.pending_human_decisions.length, 1);

    session = await manager.controlPlane.sessionService.requireSession(adopted.session.session_id);
    session.status = "active";
    session.state.blockers = [];
    session.state.pending_human_decisions = [];
    session.state.phase = "mutated_after_checkpoint";
    session = await manager.controlPlane.sessionService.saveSession(session);

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);

    assert.equal(resumed.session.status, "waiting_human");
    assert.equal(resumed.session.state.blockers.length, 1);
    assert.equal(resumed.session.state.pending_human_decisions.length, 1);
    assert.equal(resumed.session.state.blockers[0]?.blocker_id, "blk_recovery_001");
    assert.equal(resumed.session.state.pending_human_decisions[0]?.decision_id, "dec_recovery_001");
  } finally {
    await manager.cleanup();
  }
});

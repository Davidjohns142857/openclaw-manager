import assert from "node:assert/strict";
import { test } from "node:test";

import { createTempManager } from "./helpers.ts";

test("focus should collapse one noisy session into at most one next-action item", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Attention collapse",
      objective: "Focus should reduce attention load."
    });
    const session = await manager.controlPlane.sessionService.requireSession(
      adopted.session.session_id
    );

    session.status = "waiting_human";
    session.state.blockers.push({
      blocker_id: "blk_001",
      type: "external_dependency",
      summary: "Waiting on external approval",
      detected_at: "2026-03-15T00:00:00Z",
      severity: "high"
    });
    session.state.pending_human_decisions.push({
      decision_id: "dec_001",
      summary: "Approve the next step",
      requested_at: "2026-03-15T00:00:00Z",
      urgency: "high"
    });
    session.state.pending_external_inputs.push("req_focus_001");
    session.metrics.last_activity_at = "2026-03-14T00:00:00Z";
    session.metadata.pending_inbound_count = 1;
    session.metadata.summary_needs_refresh = true;
    await manager.controlPlane.sessionService.saveSession(session);

    const focus = await manager.controlPlane.focus();
    const sameSessionItems = focus.filter((item) => item.session_id === adopted.session.session_id);

    assert.ok(
      sameSessionItems.length <= 1,
      "focus should compress one session into one best-next-action item."
    );
  } finally {
    await manager.cleanup();
  }
});

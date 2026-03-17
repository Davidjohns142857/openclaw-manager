import assert from "node:assert/strict";
import { test } from "node:test";

import { ManagerServer } from "../src/api/server.ts";
import { createTempManager, dispatchRoute } from "./helpers.ts";

test("session.activity projects run, queue, and summary state through the canonical server contract", async () => {
  const manager = await createTempManager();

  try {
    const server = new ManagerServer(manager.controlPlane, manager.config);
    const adopted = await manager.controlPlane.adoptSession({
      title: "Activity projection",
      objective: "Verify session.activity semantics."
    });

    const session = await manager.controlPlane.sessionService.requireSession(
      adopted.session.session_id
    );
    session.state.pending_external_inputs = ["req_001", "req_002"];
    session.metadata.pending_inbound_count = 2;
    session.metadata.summary_needs_refresh = true;
    await manager.controlPlane.sessionService.saveSession(session);

    const detailResponse = await dispatchRoute(
      server,
      "GET",
      `/sessions/${adopted.session.session_id}`
    );

    assert.equal(detailResponse.statusCode, 200);
    const detail = detailResponse.body as {
      session: {
        activity: {
          run: { state: string; phase: string };
          queue: { state: string; count: number };
          summary: { state: string };
        };
      };
    };

    assert.deepEqual(detail.session.activity, {
      run: {
        state: "running",
        phase: "running"
      },
      queue: {
        state: "pending",
        count: 2
      },
      summary: {
        state: "stale"
      }
    });

    await manager.controlPlane.closeSession(adopted.session.session_id, {
      outcome_summary: "Close for activity contract.",
      resolution: "completed"
    });

    const closedResponse = await dispatchRoute(
      server,
      "GET",
      `/sessions/${adopted.session.session_id}`
    );
    const closed = closedResponse.body as {
      session: {
        activity: {
          run: { state: string; phase: string };
        };
      };
    };

    assert.equal(closed.session.activity.run.state, "idle");
    assert.equal(closed.session.activity.run.phase, "completed");
  } finally {
    await manager.cleanup();
  }
});

test("focus chooses waiting_human as the primary category and preserves merged signals", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Interaction precedence",
      objective: "Verify focus precedence."
    });
    const session = await manager.controlPlane.sessionService.requireSession(
      adopted.session.session_id
    );

    session.active_run_id = null;
    session.status = "waiting_human";
    session.state.blockers.push({
      blocker_id: "blk_interaction",
      type: "external_dependency",
      summary: "Missing approval from upstream",
      detected_at: "2026-03-15T00:00:00Z",
      severity: "high"
    });
    session.state.pending_human_decisions.push({
      decision_id: "dec_interaction",
      summary: "Approve whether this task should continue",
      requested_at: "2026-03-15T00:00:00Z",
      urgency: "medium"
    });
    session.state.pending_external_inputs = ["req_interaction"];
    session.metrics.last_activity_at = "2026-03-14T00:00:00Z";
    session.metadata.pending_inbound_count = 1;
    session.metadata.summary_needs_refresh = true;
    await manager.controlPlane.sessionService.saveSession(session);

    const focus = await manager.controlPlane.focus();
    const item = focus.find((entry) => entry.session_id === adopted.session.session_id);

    assert.ok(item);
    assert.equal(item.category, "waiting_human");
    assert.equal(item.expected_human_action, "Resolve the pending human decision");
    assert.equal(item.metadata.primary_category_rule, "waiting_human > blocked > desynced > stale > summary_drift");
    assert.deepEqual(item.metadata.merged_categories, [
      "waiting_human",
      "blocked",
      "desynced",
      "stale",
      "summary_drift"
    ]);
  } finally {
    await manager.cleanup();
  }
});

test("focus orders sessions after per-session collapse by actionable priority", async () => {
  const manager = await createTempManager();

  try {
    const human = await manager.controlPlane.adoptSession({
      title: "Human action first",
      objective: "This session requires an explicit decision.",
      priority: "high"
    });
    const stale = await manager.controlPlane.adoptSession({
      title: "Quiet stale task",
      objective: "This session is only stale.",
      priority: "low"
    });

    const humanSession = await manager.controlPlane.sessionService.requireSession(
      human.session.session_id
    );
    humanSession.active_run_id = null;
    humanSession.status = "waiting_human";
    humanSession.state.pending_human_decisions.push({
      decision_id: "dec_queue",
      summary: "Choose whether to continue",
      requested_at: "2026-03-15T00:00:00Z",
      urgency: "high"
    });
    await manager.controlPlane.sessionService.saveSession(humanSession);

    const staleSession = await manager.controlPlane.sessionService.requireSession(
      stale.session.session_id
    );
    staleSession.active_run_id = null;
    staleSession.metrics.last_activity_at = "2026-03-14T00:00:00Z";
    staleSession.metadata.summary_needs_refresh = true;
    await manager.controlPlane.sessionService.saveSession(staleSession);

    const focus = await manager.controlPlane.focus();

    assert.equal(focus[0]?.session_id, human.session.session_id);
    assert.equal(focus[0]?.category, "waiting_human");
    assert.equal(focus[1]?.session_id, stale.session.session_id);
    assert.equal(focus[1]?.category, "stale");
  } finally {
    await manager.cleanup();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { ManagerServer } from "../src/api/server.ts";
import { createTempManager, dispatchRoute, sessionPaths, readJsonl } from "./helpers.ts";

test("reserved decision and blocker routes return 501 canonical envelopes when feature flags are off", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Reserved route disabled behavior",
      objective: "Routes should exist before minimal mutation is enabled."
    });
    const server = new ManagerServer(manager.controlPlane, manager.config);
    const checkpointBefore = await manager.store.readCheckpoint(
      adopted.session.session_id,
      adopted.run.run_id
    );
    const paths = sessionPaths(manager.tempRoot, adopted.session.session_id, adopted.run.run_id);
    const sessionEventsBefore = await readJsonl<{ event_type: string }>(paths.sessionEvents);
    const runEventsBefore = await readJsonl<{ event_type: string }>(paths.events);

    const responses = await Promise.all([
      dispatchRoute(server, "POST", `/sessions/${adopted.session.session_id}/decisions`, {
        summary: "Need a go/no-go decision."
      }),
      dispatchRoute(
        server,
        "POST",
        `/sessions/${adopted.session.session_id}/decisions/dec_disabled_001/resolve`,
        {
          resolution_summary: "Decision has been made."
        }
      ),
      dispatchRoute(server, "POST", `/sessions/${adopted.session.session_id}/blockers`, {
        type: "external_dependency",
        summary: "Need upstream approval."
      }),
      dispatchRoute(
        server,
        "POST",
        `/sessions/${adopted.session.session_id}/blockers/blk_disabled_001/clear`,
        {
          resolution_summary: "Approval arrived."
        }
      )
    ]);

    for (const response of responses) {
      assert.equal(response.statusCode, 501);
      const body = response.body as {
        status: string;
        error_code: string;
        mutation_applied: boolean;
        session: { session_id: string };
        checkpoint: { session_id: string } | null;
      };
      assert.equal(body.status, "not_enabled");
      assert.equal(body.error_code, "FEATURE_NOT_ENABLED");
      assert.equal(body.mutation_applied, false);
      assert.equal(body.session.session_id, adopted.session.session_id);
      assert.equal(body.checkpoint?.session_id, adopted.session.session_id);
    }

    const checkpointAfter = await manager.store.readCheckpoint(
      adopted.session.session_id,
      adopted.run.run_id
    );
    const sessionEventsAfter = await readJsonl<{ event_type: string }>(paths.sessionEvents);
    const runEventsAfter = await readJsonl<{ event_type: string }>(paths.events);

    assert.deepEqual(checkpointAfter, checkpointBefore);
    assert.deepEqual(sessionEventsAfter, sessionEventsBefore);
    assert.deepEqual(runEventsAfter, runEventsBefore);
  } finally {
    await manager.cleanup();
  }
});

test("decision request minimal mutation writes an event and updates focus without touching checkpoint or run state", async () => {
  const manager = await createTempManager({
    features: {
      decision_lifecycle_v1: true,
      blocker_lifecycle_v1: false
    }
  });

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Decision request minimal mutation",
      objective: "Feature-gated route should stay thin."
    });
    const server = new ManagerServer(manager.controlPlane, manager.config);
    const checkpointBefore = await manager.store.readCheckpoint(
      adopted.session.session_id,
      adopted.run.run_id
    );

    const response = await dispatchRoute(server, "POST", `/sessions/${adopted.session.session_id}/decisions`, {
      decision_id: "dec_req_v1",
      summary: "Need approval to continue the current plan.",
      urgency: "high",
      requested_by_ref: "user_primary"
    });

    assert.equal(response.statusCode, 200);
    const body = response.body as {
      status: string;
      mutation_applied: boolean;
      session: {
        session_id: string;
        status: string;
        status_reason: { source_kind: string; source_decision_id: string | null };
        metadata: Record<string, unknown>;
      };
      run: { run_id: string } | null;
      checkpoint: unknown;
    };

    assert.equal(body.status, "accepted");
    assert.equal(body.mutation_applied, true);
    assert.equal(body.session.status, "waiting_human");
    assert.equal(body.session.status_reason.source_kind, "pending_human_decision");
    assert.equal(body.session.status_reason.source_decision_id, "dec_req_v1");
    assert.equal(body.run?.run_id, adopted.run.run_id);

    const checkpointAfter = await manager.store.readCheckpoint(
      adopted.session.session_id,
      adopted.run.run_id
    );
    assert.deepEqual(checkpointAfter, checkpointBefore);

    const focus = await manager.controlPlane.focus();
    const item = focus.find((entry) => entry.session_id === adopted.session.session_id);
    assert.ok(item);
    assert.equal(item.category, "waiting_human");

    const session = await manager.controlPlane.sessionService.requireSession(adopted.session.session_id);
    const reserved = session.metadata.reserved_contract_state as {
      pending_human_decisions: Array<{ decision_id: string }>;
    };
    assert.equal(reserved.pending_human_decisions.length, 1);
    assert.equal(reserved.pending_human_decisions[0]?.decision_id, "dec_req_v1");

    const paths = sessionPaths(manager.tempRoot, adopted.session.session_id, adopted.run.run_id);
    const runEvents = await readJsonl<{ event_type: string }>(paths.events);
    assert.equal(
      runEvents.filter((event) => event.event_type === "human_decision_requested").length,
      1
    );

    const runs = await manager.store.listRuns(adopted.session.session_id);
    assert.equal(runs.length, 1);
  } finally {
    await manager.cleanup();
  }
});

test("blocker detect minimal mutation writes an event and updates focus without touching checkpoint or run state", async () => {
  const manager = await createTempManager({
    features: {
      decision_lifecycle_v1: false,
      blocker_lifecycle_v1: true
    }
  });

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Blocker detect minimal mutation",
      objective: "Feature-gated blocker route should stay thin."
    });
    const server = new ManagerServer(manager.controlPlane, manager.config);
    const checkpointBefore = await manager.store.readCheckpoint(
      adopted.session.session_id,
      adopted.run.run_id
    );

    const response = await dispatchRoute(server, "POST", `/sessions/${adopted.session.session_id}/blockers`, {
      blocker_id: "blk_req_v1",
      type: "external_dependency",
      summary: "Need upstream approval before execution can continue.",
      severity: "high",
      detected_by_ref: "openclaw_manager"
    });

    assert.equal(response.statusCode, 200);
    const body = response.body as {
      status: string;
      mutation_applied: boolean;
      session: {
        session_id: string;
        status: string;
        status_reason: { source_kind: string; source_blocker_id: string | null };
        metadata: Record<string, unknown>;
      };
      run: { run_id: string } | null;
    };

    assert.equal(body.status, "accepted");
    assert.equal(body.mutation_applied, true);
    assert.equal(body.session.status, "blocked");
    assert.equal(body.session.status_reason.source_kind, "blocker");
    assert.equal(body.session.status_reason.source_blocker_id, "blk_req_v1");
    assert.equal(body.run?.run_id, adopted.run.run_id);

    const checkpointAfter = await manager.store.readCheckpoint(
      adopted.session.session_id,
      adopted.run.run_id
    );
    assert.deepEqual(checkpointAfter, checkpointBefore);

    const focus = await manager.controlPlane.focus();
    const item = focus.find((entry) => entry.session_id === adopted.session.session_id);
    assert.ok(item);
    assert.equal(item.category, "blocked");

    const session = await manager.controlPlane.sessionService.requireSession(adopted.session.session_id);
    const reserved = session.metadata.reserved_contract_state as {
      blockers: Array<{ blocker_id: string }>;
    };
    assert.equal(reserved.blockers.length, 1);
    assert.equal(reserved.blockers[0]?.blocker_id, "blk_req_v1");

    const paths = sessionPaths(manager.tempRoot, adopted.session.session_id, adopted.run.run_id);
    const runEvents = await readJsonl<{ event_type: string }>(paths.events);
    assert.equal(runEvents.filter((event) => event.event_type === "blocker_detected").length, 1);

    const runs = await manager.store.listRuns(adopted.session.session_id);
    assert.equal(runs.length, 1);
  } finally {
    await manager.cleanup();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { ManagerServer } from "../src/api/server.ts";
import { createTempManager, dispatchRoute } from "./helpers.ts";

test("paused run projects session waiting_human from run rather than a separate session state machine", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Paused run projection",
      objective: "Session summary should point back to the paused run."
    });

    const settled = await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "waiting_human",
      summary: "Need approval before continuing.",
      reason_code: "human_approval_required"
    });

    const detail = await manager.controlPlane.getSessionDetail(adopted.session.session_id);
    const statusReason = detail.session.metadata.session_status_reason as {
      source_kind: string;
      source_run_id: string | null;
      source_run_status: string | null;
    };

    assert.equal(detail.session.status, "waiting_human");
    assert.equal(statusReason.source_kind, "paused_run");
    assert.equal(statusReason.source_run_id, settled.run.run_id);
    assert.equal(statusReason.source_run_status, "waiting_human");
  } finally {
    await manager.cleanup();
  }
});

test("reserved decision and blocker facts project session summary without mutating run state", async () => {
  const manager = await createTempManager({
    features: {
      decision_lifecycle_v1: true,
      blocker_lifecycle_v1: true
    }
  });

  try {
    const server = new ManagerServer(manager.controlPlane, manager.config);
    const decisionSession = await manager.controlPlane.adoptSession({
      title: "Decision projection",
      objective: "Decision facts should drive waiting_human summary."
    });

    const decisionResponse = await dispatchRoute(
      server,
      "POST",
      `/sessions/${decisionSession.session.session_id}/decisions`,
      {
        decision_id: "dec_status_projection_001",
        summary: "Approve whether the manager should continue."
      }
    );
    assert.equal(decisionResponse.statusCode, 200);
    const decisionBody = decisionResponse.body as {
      session: {
        status: string;
        status_reason: {
          source_kind: string;
          source_decision_id: string | null;
          source_run_id: string | null;
        };
      };
      run: { run_id: string; status: string } | null;
    };

    assert.equal(decisionBody.session.status, "waiting_human");
    assert.equal(decisionBody.session.status_reason.source_kind, "pending_human_decision");
    assert.equal(decisionBody.session.status_reason.source_decision_id, "dec_status_projection_001");
    assert.equal(decisionBody.session.status_reason.source_run_id, null);
    assert.equal(decisionBody.run?.status, "running");

    const blockerSession = await manager.controlPlane.adoptSession({
      title: "Blocker projection",
      objective: "Blocker facts should drive blocked summary."
    });

    const blockerResponse = await dispatchRoute(
      server,
      "POST",
      `/sessions/${blockerSession.session.session_id}/blockers`,
      {
        blocker_id: "blk_status_projection_001",
        type: "external_dependency",
        summary: "Need upstream approval."
      }
    );
    assert.equal(blockerResponse.statusCode, 200);
    const blockerBody = blockerResponse.body as {
      session: {
        status: string;
        status_reason: {
          source_kind: string;
          source_blocker_id: string | null;
          source_run_id: string | null;
        };
      };
      run: { run_id: string; status: string } | null;
    };

    assert.equal(blockerBody.session.status, "blocked");
    assert.equal(blockerBody.session.status_reason.source_kind, "blocker");
    assert.equal(blockerBody.session.status_reason.source_blocker_id, "blk_status_projection_001");
    assert.equal(blockerBody.session.status_reason.source_run_id, null);
    assert.equal(blockerBody.run?.status, "running");
  } finally {
    await manager.cleanup();
  }
});

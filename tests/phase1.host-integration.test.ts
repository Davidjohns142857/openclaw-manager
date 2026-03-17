import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { executeManagerCommand, type ManagerCommandClient } from "../src/skill/commands.ts";
import { ManagerSidecarClient } from "../src/skill/sidecar-client.ts";
import { startTempSidecar } from "./helpers.ts";

const repoRoot = "/Users/yangshangqing/metaclaw";

test("thin host integration runs the canonical command flow over real HTTP", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const health = await client.health();
    assert.equal(health.status, "ok");

    const adopted = (await executeManagerCommand(client, "/adopt", {
      title: "Host integration adoption",
      objective: "Verify the thin host path uses canonical HTTP."
    })) as {
      session: { session_id: string; activity: { run: { state: string } } };
    };

    assert.equal(adopted.session.activity.run.state, "running");
    const sessionId = adopted.session.session_id;

    const sessions = (await executeManagerCommand(client, "/tasks")) as Array<{
      session_id: string;
      activity: { run: { phase: string } };
    }>;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].session_id, sessionId);
    assert.equal(sessions[0].activity.run.phase, "running");

    const timeline = await client.getSessionTimeline(sessionId);
    assert.equal(timeline.contract_id, "session_run_timeline_v1");
    assert.equal(timeline.run_count, 1);
    assert.equal(timeline.runs[0]?.trigger.trigger_type, "manual");

    const bound = (await executeManagerCommand(client, "/bind", {
      session_id: sessionId,
      source_type: "telegram",
      source_thread_key: "tg-host-flow-001"
    })) as {
      created: boolean;
      binding: { session_id: string; source_thread_key: string };
    };
    assert.equal(bound.created, true);
    assert.equal(bound.binding.session_id, sessionId);
    assert.equal(bound.binding.source_thread_key, "tg-host-flow-001");

    const reboundTarget = await client.adopt({
      title: "Host integration rebound target",
      objective: "Verify binding lifecycle stays on canonical HTTP."
    });
    const rebound = (await executeManagerCommand(client, "/rebind", {
      binding_id: bound.binding.binding_id,
      session_id: reboundTarget.session.session_id
    })) as {
      previous_session_id: string;
      changed: boolean;
      binding: { session_id: string };
    };
    assert.equal(rebound.changed, true);
    assert.equal(rebound.previous_session_id, sessionId);
    assert.equal(rebound.binding.session_id, reboundTarget.session.session_id);

    const unbound = (await executeManagerCommand(client, "/unbind", {
      binding_id: bound.binding.binding_id,
      reason: "Route moved away from host flow."
    })) as {
      changed: boolean;
      binding: { status: string };
    };
    assert.equal(unbound.changed, true);
    assert.equal(unbound.binding.status, "disabled");

    const checkpointed = (await executeManagerCommand(client, "/checkpoint", {
      session_id: sessionId
    })) as {
      checkpoint: { session_id: string };
      summary: string;
    };
    assert.equal(checkpointed.checkpoint.session_id, sessionId);
    assert.match(checkpointed.summary, /Host integration adoption|Session adopted/i);

    const resumed = (await executeManagerCommand(client, "/resume", {
      session_id: sessionId
    })) as {
      session: { session_id: string; activity: { summary: { state: string } } };
      checkpoint: { session_id: string };
    };
    assert.equal(resumed.session.session_id, sessionId);
    assert.equal(resumed.session.activity.summary.state, "fresh");
    assert.equal(resumed.checkpoint.session_id, sessionId);

    const closed = (await executeManagerCommand(client, "/close", {
      session_id: sessionId,
      outcome_summary: "Completed through thin host integration."
    })) as {
      session: { status: string; activity: { run: { state: string } } };
    };
    assert.equal(closed.session.status, "completed");
    assert.equal(closed.session.activity.run.state, "idle");
  } finally {
    await sidecar.cleanup();
  }
});

test("host-side client exposes typed reserved-route methods without adding command-surface coupling", async () => {
  const disabledSidecar = await startTempSidecar();

  try {
    const disabledClient = new ManagerSidecarClient({ baseUrl: disabledSidecar.baseUrl });
    const adopted = await disabledClient.adopt({
      title: "Reserved client methods",
      objective: "Client should expose typed reserved-route methods."
    });
    const sessionId = adopted.session.session_id;

    const decisionDisabled = await disabledClient.requestHumanDecision(sessionId, {
      decision_id: "dec_client_disabled",
      summary: "Need a human decision before continuing."
    });
    assert.equal(decisionDisabled.status, "not_enabled");
    assert.equal(decisionDisabled.error_code, "FEATURE_NOT_ENABLED");
    assert.equal(decisionDisabled.mutation_applied, false);
    assert.equal(decisionDisabled.session.session_id, sessionId);
    assert.ok(decisionDisabled.session.activity);

    const blockerDisabled = await disabledClient.detectBlocker(sessionId, {
      blocker_id: "blk_client_disabled",
      type: "external_dependency",
      summary: "Waiting on upstream approval."
    });
    assert.equal(blockerDisabled.status, "not_enabled");
    assert.equal(blockerDisabled.error_code, "FEATURE_NOT_ENABLED");
    assert.equal(blockerDisabled.mutation_applied, false);
    assert.equal(blockerDisabled.session.session_id, sessionId);
  } finally {
    await disabledSidecar.cleanup();
  }

  const enabledSidecar = await startTempSidecar({
    features: {
      decision_lifecycle_v1: true,
      blocker_lifecycle_v1: true
    }
  });

  try {
    const enabledClient = new ManagerSidecarClient({ baseUrl: enabledSidecar.baseUrl });
    const adopted = await enabledClient.adopt({
      title: "Reserved client methods enabled",
      objective: "Client should support minimal mutation through typed methods."
    });
    const sessionId = adopted.session.session_id;

    const decisionAccepted = await enabledClient.requestHumanDecision(sessionId, {
      decision_id: "dec_client_enabled",
      summary: "Approve whether the task should continue.",
      urgency: "high",
      requested_by_ref: "user_primary"
    });
    assert.equal(decisionAccepted.status, "accepted");
    assert.equal(decisionAccepted.error_code, null);
    assert.equal(decisionAccepted.mutation_applied, true);
    assert.equal(decisionAccepted.session.session_id, sessionId);

    const decisionResolved = await enabledClient.resolveHumanDecision(
      sessionId,
      "dec_client_enabled",
      {
        resolution_summary: "Approved by the user.",
        resolved_by_ref: "user_primary"
      }
    );
    assert.equal(decisionResolved.status, "accepted");
    assert.equal(decisionResolved.mutation_applied, true);
    assert.equal(decisionResolved.session.session_id, sessionId);

    const blockerAccepted = await enabledClient.detectBlocker(sessionId, {
      blocker_id: "blk_client_enabled",
      type: "external_dependency",
      summary: "Need final upstream sign-off.",
      severity: "high"
    });
    assert.equal(blockerAccepted.status, "accepted");
    assert.equal(blockerAccepted.mutation_applied, true);
    assert.equal(blockerAccepted.session.session_id, sessionId);

    const blockerCleared = await enabledClient.clearBlocker(sessionId, "blk_client_enabled", {
      resolution_summary: "Sign-off arrived."
    });
    assert.equal(blockerCleared.status, "accepted");
    assert.equal(blockerCleared.mutation_applied, true);
    assert.equal(blockerCleared.session.session_id, sessionId);
    assert.ok(blockerCleared.session.activity);
  } finally {
    await enabledSidecar.cleanup();
  }
});

test("skill command layer depends on the client contract rather than control-plane internals", async () => {
  const source = await readFile(path.join(repoRoot, "src/skill/commands.ts"), "utf8");
  assert.doesNotMatch(source, /control-plane/);

  const calls: string[] = [];
  const fakeClient: ManagerCommandClient = {
    async listSessions() {
      calls.push("tasks");
      return ["tasks"];
    },
    async focus() {
      calls.push("focus");
      return ["focus"];
    },
    async digest() {
      calls.push("digest");
      return { digest: "digest" };
    },
    async distill() {
      calls.push("distill");
      return { contract_id: "local_distillation_v1", facts: [] } as never;
    },
    async adopt() {
      calls.push("adopt");
      return { ok: true };
    },
    async bind(input: { session_id: string; source_type: string; source_thread_key: string }) {
      calls.push(`bind:${input.session_id}:${input.source_type}:${input.source_thread_key}`);
      return { ok: true };
    },
    async disableBinding(bindingId: string) {
      calls.push(`unbind:${bindingId}`);
      return { bindingId };
    },
    async rebindBinding(bindingId: string, input: { session_id: string }) {
      calls.push(`rebind:${bindingId}:${input.session_id}`);
      return { bindingId, sessionId: input.session_id };
    },
    async resume(sessionId: string) {
      calls.push(`resume:${sessionId}`);
      return { sessionId };
    },
    async checkpoint(sessionId: string) {
      calls.push(`checkpoint:${sessionId}`);
      return { sessionId };
    },
    async share(sessionId: string) {
      calls.push(`share:${sessionId}`);
      return { sessionId };
    },
    async close(sessionId: string) {
      calls.push(`close:${sessionId}`);
      return { sessionId };
    }
  };

  await assert.rejects(() => executeManagerCommand(fakeClient, "/resume"), /session_id is required/);
  await executeManagerCommand(fakeClient, "/tasks");
  await executeManagerCommand(fakeClient, "/distill");
  await executeManagerCommand(fakeClient, "/adopt", {
    title: "Boundary check",
    objective: "Verify command executor mapping."
  });
  await executeManagerCommand(fakeClient, "/bind", {
    session_id: "sess_boundary",
    source_type: "telegram",
    source_thread_key: "tg_boundary"
  });
  await executeManagerCommand(fakeClient, "/unbind", {
    binding_id: "bind_boundary_001"
  });
  await executeManagerCommand(fakeClient, "/rebind", {
    binding_id: "bind_boundary_001",
    session_id: "sess_boundary_2"
  });
  await executeManagerCommand(fakeClient, "/checkpoint", {
    session_id: "sess_boundary"
  });
  await executeManagerCommand(fakeClient, "/close", {
    session_id: "sess_boundary",
    outcome_summary: "Boundary closed."
  });

  assert.deepEqual(calls, [
    "tasks",
    "distill",
    "adopt",
    "bind:sess_boundary:telegram:tg_boundary",
    "unbind:bind_boundary_001",
    "rebind:bind_boundary_001:sess_boundary_2",
    "checkpoint:sess_boundary",
    "close:sess_boundary"
  ]);
});

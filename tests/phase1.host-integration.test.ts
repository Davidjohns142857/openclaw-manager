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
    async adopt() {
      calls.push("adopt");
      return { ok: true };
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
  await executeManagerCommand(fakeClient, "/adopt", {
    title: "Boundary check",
    objective: "Verify command executor mapping."
  });
  await executeManagerCommand(fakeClient, "/checkpoint", {
    session_id: "sess_boundary"
  });
  await executeManagerCommand(fakeClient, "/close", {
    session_id: "sess_boundary",
    outcome_summary: "Boundary closed."
  });

  assert.deepEqual(calls, ["tasks", "adopt", "checkpoint:sess_boundary", "close:sess_boundary"]);
});

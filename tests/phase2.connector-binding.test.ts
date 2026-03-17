import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  executeManagerCommand,
  type ManagerCommandClient
} from "../src/skill/commands.ts";
import {
  ManagerSidecarClient,
  ManagerSidecarHttpError
} from "../src/skill/sidecar-client.ts";
import { readJson, readJsonl, sessionPaths, startTempSidecar } from "./helpers.ts";

test("bind writes a durable connector registry entry and is idempotent for the same session/source pair", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const adopted = await client.adopt({
      title: "Bound external source",
      objective: "Verify source binding registry durability."
    });

    const first = await executeManagerCommand(client, "/bind", {
      session_id: adopted.session.session_id,
      source_type: "telegram",
      source_thread_key: "tg-thread-001",
      metadata: {
        bound_by: "acceptance"
      }
    }) as {
      created: boolean;
      binding: { source_type: string; source_thread_key: string };
      session: { source_channels: Array<{ source_ref: string }> };
    };

    assert.equal(first.created, true);
    assert.equal(first.binding.source_type, "telegram");
    assert.equal(first.binding.source_thread_key, "tg-thread-001");
    assert.equal(first.session.source_channels[0]?.source_ref, "tg-thread-001");

    const second = await client.bind({
      session_id: adopted.session.session_id,
      source_type: "telegram",
      source_thread_key: "tg-thread-001"
    });
    assert.equal(second.created, false);

    const bindings = await client.listBindings();
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0]?.session_id, adopted.session.session_id);

    const bindingsFile = path.join(sidecar.tempRoot, "connectors", "bindings.json");
    const durableBindings = await readJson<Array<{ source_thread_key: string }>>(bindingsFile);
    assert.equal(durableBindings.length, 1);
    assert.equal(durableBindings[0]?.source_thread_key, "tg-thread-001");

    const runId = adopted.run?.run_id;
    assert.ok(runId);
    const paths = sessionPaths(sidecar.tempRoot, adopted.session.session_id, runId!);
    const events = await readJsonl<{ event_type: string }>(paths.events);
    assert.equal(events.filter((event) => event.event_type === "external_trigger_bound").length, 2);
  } finally {
    await sidecar.cleanup();
  }
});

test("inbound-message resolves target_session_id from an active binding when connector only sends source metadata", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const adopted = await client.adopt({
      title: "Binding aware inbound",
      objective: "Connector should not need to know session_id after binding."
    });

    await client.bind({
      session_id: adopted.session.session_id,
      source_type: "telegram",
      source_thread_key: "tg-thread-002"
    });

    const inbound = await client.inboundMessage({
      request_id: "req_binding_aware_001",
      source_type: "telegram",
      source_thread_key: "tg-thread-002",
      message_type: "user_message",
      content: "A bound external reply arrived."
    });

    assert.equal(inbound.duplicate, false);
    assert.equal(inbound.session.session_id, adopted.session.session_id);
    assert.equal(inbound.session.activity.queue.state, "pending");
  } finally {
    await sidecar.cleanup();
  }
});

test("binding conflicts reject cross-session reuse of the same external thread and mismatched explicit inbound targets", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const first = await client.adopt({
      title: "Primary bound session",
      objective: "Own the external thread."
    });
    const second = await client.adopt({
      title: "Competing session",
      objective: "Should not steal the same external thread."
    });

    await client.bind({
      session_id: first.session.session_id,
      source_type: "telegram",
      source_thread_key: "tg-thread-003"
    });

    await assert.rejects(
      () =>
        client.bind({
          session_id: second.session.session_id,
          source_type: "telegram",
          source_thread_key: "tg-thread-003"
        }),
      (error: unknown) =>
        error instanceof ManagerSidecarHttpError && error.statusCode === 409
    );

    await assert.rejects(
      () =>
        client.inboundMessage({
          request_id: "req_binding_conflict_001",
          source_type: "telegram",
          source_thread_key: "tg-thread-003",
          target_session_id: second.session.session_id,
          message_type: "user_message",
          content: "This should be rejected."
        }),
      (error: unknown) =>
        error instanceof ManagerSidecarHttpError && error.statusCode === 409
    );
  } finally {
    await sidecar.cleanup();
  }
});

test("unbound external inbound without target_session_id returns 404 instead of creating an implicit session", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });

    await assert.rejects(
      () =>
        client.inboundMessage({
          request_id: "req_binding_missing_001",
          source_type: "telegram",
          source_thread_key: "tg-thread-missing",
          message_type: "user_message",
          content: "No binding exists."
        }),
      (error: unknown) =>
        error instanceof ManagerSidecarHttpError && error.statusCode === 404
    );

    const sessions = await client.listSessions();
    assert.equal(sessions.length, 0);
  } finally {
    await sidecar.cleanup();
  }
});

test("skill command layer exposes bind through the client contract without importing connector internals", async () => {
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
    async bind(input) {
      calls.push(`bind:${input.session_id}:${input.source_type}:${input.source_thread_key}`);
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

  await executeManagerCommand(fakeClient, "/bind", {
    session_id: "sess_bind_boundary",
    source_type: "telegram",
    source_thread_key: "tg-boundary-001"
  });

  assert.deepEqual(calls, ["bind:sess_bind_boundary:telegram:tg-boundary-001"]);
});

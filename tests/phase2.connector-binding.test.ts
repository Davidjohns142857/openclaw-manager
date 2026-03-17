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

    const bindings = await client.listBindings({ status: "active" });
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

test("disable binding removes the active source-channel projection and keeps a disabled durable record", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const adopted = await client.adopt({
      title: "Disable binding lifecycle",
      objective: "Verify bindings can be disabled without deleting history."
    });

    const bound = await client.bind({
      session_id: adopted.session.session_id,
      source_type: "telegram",
      source_thread_key: "tg-thread-disable-001"
    });

    const disabled = await client.disableBinding(bound.binding.binding_id, {
      reason: "source archived",
      disabled_by_ref: "user_primary"
    });
    assert.equal(disabled.changed, true);
    assert.equal(disabled.binding.status, "disabled");
    assert.equal(disabled.session.source_channels.length, 0);

    const activeBindings = await client.listBindings({ status: "active" });
    assert.equal(activeBindings.length, 0);
    const disabledBindings = await client.listBindings({ status: "disabled" });
    assert.equal(disabledBindings.length, 1);
    assert.equal(disabledBindings[0]?.binding_id, bound.binding.binding_id);

    await assert.rejects(
      () =>
        client.inboundMessage({
          request_id: "req_binding_disabled_001",
          source_type: "telegram",
          source_thread_key: "tg-thread-disable-001",
          message_type: "user_message",
          content: "Disabled bindings should not resolve."
        }),
      (error: unknown) =>
        error instanceof ManagerSidecarHttpError && error.statusCode === 404
    );

    const runId = adopted.run?.run_id;
    assert.ok(runId);
    const paths = sessionPaths(sidecar.tempRoot, adopted.session.session_id, runId!);
    const events = await readJsonl<{ event_type: string }>(paths.events);
    assert.equal(events.filter((event) => event.event_type === "external_trigger_unbound").length, 1);
  } finally {
    await sidecar.cleanup();
  }
});

test("rebind moves an active source thread onto a new session and keeps inbound routing canonical", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const first = await client.adopt({
      title: "Rebind source primary",
      objective: "Own the source before rebind."
    });
    const second = await client.adopt({
      title: "Rebind source target",
      objective: "Receive the source after rebind."
    });

    const bound = await client.bind({
      session_id: first.session.session_id,
      source_type: "telegram",
      source_thread_key: "tg-thread-rebind-001"
    });

    const rebound = await client.rebindBinding(bound.binding.binding_id, {
      session_id: second.session.session_id,
      rebound_by_ref: "user_primary"
    });
    assert.equal(rebound.changed, true);
    assert.equal(rebound.previous_session_id, first.session.session_id);
    assert.equal(rebound.binding.status, "active");
    assert.equal(rebound.binding.session_id, second.session.session_id);
    assert.equal(rebound.session.session_id, second.session.session_id);
    assert.equal(rebound.session.source_channels[0]?.source_ref, "tg-thread-rebind-001");

    const firstDetail = await client.getSession(first.session.session_id);
    assert.equal(firstDetail.session.source_channels.length, 0);

    const routed = await client.inboundMessage({
      request_id: "req_binding_rebind_001",
      source_type: "telegram",
      source_thread_key: "tg-thread-rebind-001",
      message_type: "user_message",
      content: "This should arrive on the rebound session."
    });
    assert.equal(routed.session.session_id, second.session.session_id);
    assert.equal(routed.queued, true);

    const reboundByTarget = await client.listBindings({
      session_id: second.session.session_id,
      source_type: "telegram",
      status: "active"
    });
    assert.equal(reboundByTarget.length, 1);
    assert.equal(reboundByTarget[0]?.binding_id, bound.binding.binding_id);

    const firstRunId = first.run?.run_id;
    assert.ok(firstRunId);
    const firstPaths = sessionPaths(sidecar.tempRoot, first.session.session_id, firstRunId!);
    const firstEvents = await readJsonl<{ event_type: string }>(firstPaths.events);
    assert.equal(firstEvents.filter((event) => event.event_type === "external_trigger_rebound").length, 1);
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

test("binding hot-path reads reuse the cached validated registry", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const adopted = await client.adopt({
      title: "Binding cache hot path",
      objective: "Active binding lookup should not revalidate unchanged registry on every read."
    });

    await client.bind({
      session_id: adopted.session.session_id,
      source_type: "telegram",
      source_thread_key: "tg-thread-cache-001"
    });

    const originalValidate = sidecar.store.schemaRegistry.validateOrThrow.bind(
      sidecar.store.schemaRegistry
    );
    let connectorValidationCount = 0;
    sidecar.store.schemaRegistry.validateOrThrow = async (kind, value) => {
      if (kind === "connector-binding") {
        connectorValidationCount += 1;
      }

      return originalValidate(kind, value);
    };

    const first = await sidecar.controlPlane.bindingService.findActiveBinding(
      "telegram",
      "tg-thread-cache-001"
    );
    const second = await sidecar.controlPlane.bindingService.findActiveBinding(
      "telegram",
      "tg-thread-cache-001"
    );

    assert.ok(first);
    assert.ok(second);
    assert.equal(connectorValidationCount, 0);
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
    async distill() {
      calls.push("distill");
      return { contract_id: "local_distillation_v1", facts: [] } as never;
    },
    async adopt() {
      calls.push("adopt");
      return { ok: true };
    },
    async bind(input) {
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

  await executeManagerCommand(fakeClient, "/bind", {
    session_id: "sess_bind_boundary",
    source_type: "telegram",
    source_thread_key: "tg-boundary-001"
  });
  await executeManagerCommand(fakeClient, "/unbind", {
    binding_id: "bind_boundary_001"
  });
  await executeManagerCommand(fakeClient, "/rebind", {
    binding_id: "bind_boundary_001",
    session_id: "sess_rebind_boundary"
  });

  assert.deepEqual(calls, [
    "bind:sess_bind_boundary:telegram:tg-boundary-001",
    "unbind:bind_boundary_001",
    "rebind:bind_boundary_001:sess_rebind_boundary"
  ]);
});

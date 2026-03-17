import assert from "node:assert/strict";
import { test } from "node:test";

import { createTempManager, readJsonl, sessionPaths } from "./helpers.ts";

test("sequential duplicate inbound request_id is treated as idempotent", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Sequential idempotency",
      objective: "Duplicate inbound should be ignored."
    });

    const input = {
      request_id: "req_idempotent_001",
      source_type: "telegram",
      source_thread_key: "tg_idempotent_001",
      target_session_id: adopted.session.session_id,
      message_type: "user_message" as const,
      content: "Sequential duplicate"
    };

    const first = await manager.controlPlane.handleInboundMessage(input);
    const second = await manager.controlPlane.handleInboundMessage(input);

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
  } finally {
    await manager.cleanup();
  }
});

test("concurrent duplicate inbound deliveries should not double-append normalized events", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Concurrent idempotency race",
      objective: "Concurrent duplicate deliveries should collapse to one fact."
    });
    const originalTryClaim = manager.store.tryClaimInboundMessage.bind(manager.store);
    let waiters = 0;
    let releaseBarrier: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    manager.store.tryClaimInboundMessage = async (message) => {
      if (message.request_id === "req_race_001") {
        waiters += 1;
        if (waiters === 2) {
          releaseBarrier();
        }
        await barrier;
      }

      return originalTryClaim(message);
    };

    const input = {
      request_id: "req_race_001",
      source_type: "telegram",
      source_thread_key: "tg_race_001",
      target_session_id: adopted.session.session_id,
      message_type: "user_message" as const,
      content: "Concurrent duplicate"
    };

    await Promise.all([
      manager.controlPlane.handleInboundMessage(input),
      manager.controlPlane.handleInboundMessage(input)
    ]);

    const paths = sessionPaths(
      manager.tempRoot,
      adopted.session.session_id,
      adopted.run.run_id
    );
    const sessionEvents = await readJsonl<{ event_type: string }>(paths.sessionEvents);
    const messageReceivedCount = sessionEvents.filter(
      (event) => event.event_type === "message_received"
    ).length;

    assert.equal(
      messageReceivedCount,
      1,
      "Concurrent duplicate deliveries should emit exactly one message_received fact."
    );
  } finally {
    await manager.cleanup();
  }
});

test("checkpoint refresh should not leave torn artifacts when summary persistence fails", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Torn write detection",
      objective: "Recovery artifacts should be all-or-nothing."
    });
    const originalWriteText = manager.store.writeText.bind(manager.store);
    const beforeCheckpoint = await manager.store.readCheckpoint(
      adopted.session.session_id,
      adopted.run.run_id
    );

    manager.store.writeText = async (filePath: string, value: string) => {
      if (filePath.includes(".summary.") && filePath.endsWith(".md.tmp")) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error("Injected staged summary write failure");
      }

      return originalWriteText(filePath, value);
    };

    await assert.rejects(() => manager.controlPlane.refreshCheckpoint(adopted.session.session_id));
    const afterCheckpoint = await manager.store.readCheckpoint(
      adopted.session.session_id,
      adopted.run.run_id
    );

    assert.deepEqual(
      afterCheckpoint,
      beforeCheckpoint,
      "A failed refresh must not commit a new checkpoint head."
    );

    manager.store.writeText = originalWriteText;
  } finally {
    await manager.cleanup();
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bootstrapManager } from "../src/skill/bootstrap.ts";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openclaw-manager-"));

try {
  const { controlPlane } = await bootstrapManager({
    stateRoot: tempRoot,
    port: 0
  });

  const adopted = await controlPlane.adoptSession({
    title: "Smoke session",
    objective: "Validate the Phase 1 control-plane scaffold.",
    tags: ["smoke", "mvp"],
    next_machine_actions: ["Refresh checkpoint", "Share snapshot"]
  });

  assert.equal(adopted.session.metrics.run_count, 1);

  const resumed = await controlPlane.resumeSession(adopted.session.session_id);
  assert.ok(resumed.summary);

  const focus = await controlPlane.focus();
  assert.ok(Array.isArray(focus));

  const digest = await controlPlane.digest();
  assert.match(digest, /Focus Digest/);

  const inbound = await controlPlane.handleInboundMessage({
    request_id: "req_smoke_001",
    source_type: "telegram",
    source_thread_key: "tg_smoke_001",
    target_session_id: adopted.session.session_id,
    message_type: "user_message",
    content: "Please continue the task.",
    metadata: {
      smoke: true
    }
  });
  assert.equal(inbound.message.target_session_id, adopted.session.session_id);
  assert.equal(inbound.duplicate, false);

  const duplicateInbound = await controlPlane.handleInboundMessage({
    request_id: "req_smoke_001",
    source_type: "telegram",
    source_thread_key: "tg_smoke_001",
    target_session_id: adopted.session.session_id,
    message_type: "user_message",
    content: "Please continue the task."
  });
  assert.equal(duplicateInbound.duplicate, true);

  const snapshot = await controlPlane.shareSession(adopted.session.session_id);
  assert.ok(snapshot.snapshot_path.includes(snapshot.snapshot_id));

  const closed = await controlPlane.closeSession(adopted.session.session_id, {
    outcome_summary: "Smoke test completed successfully.",
    resolution: "completed"
  });
  assert.equal(closed.status, "completed");

  const tasks = await controlPlane.listTasks();
  assert.equal(tasks.length, 1);

  console.log(
    JSON.stringify(
      {
        temp_root: tempRoot,
        session_id: adopted.session.session_id,
        snapshot_id: snapshot.snapshot_id,
        attention_count: focus.length,
        final_status: closed.status
      },
      null,
      2
    )
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { test } from "node:test";

import { browserThreadKey } from "../src/connectors/browser.ts";
import { ManagerSidecarClient, ManagerSidecarHttpError } from "../src/skill/sidecar-client.ts";
import { readJsonl, sessionPaths, startTempSidecar } from "./helpers.ts";

test("browser connector message normalizes into canonical inbound and resolves the session through binding", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const adopted = await client.adopt({
      title: "Browser connector session",
      objective: "Verify browser plugin messages route into an existing session."
    });
    const sourceThreadKey = browserThreadKey("sidepanel", "research-001");

    await client.bind({
      session_id: adopted.session.session_id,
      source_type: "browser",
      source_thread_key: sourceThreadKey
    });

    const payload = await client.captureBrowserMessage({
      source_thread_key: sourceThreadKey,
      message_id: "browser-msg-001",
      text: "Please keep tracking this source and organize next actions.",
      page_url: "https://example.com/research",
      page_title: "Research Notes",
      metadata: {
        surface: "sidepanel"
      }
    });

    assert.equal(payload.accepted, true);
    assert.equal(payload.source_type, "browser");
    assert.equal(payload.source_thread_key, sourceThreadKey);
    assert.equal(payload.message_id, "browser-msg-001");
    assert.equal(payload.duplicate, false);
    assert.equal(payload.session.session_id, adopted.session.session_id);
    assert.equal(payload.session.activity.queue.state, "pending");
  } finally {
    await sidecar.cleanup();
  }
});

test("browser connector duplicate message ids do not re-emit message_received facts", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const adopted = await client.adopt({
      title: "Browser duplicate delivery",
      objective: "Verify browser message retries stay idempotent."
    });
    const sourceThreadKey = browserThreadKey("popup", "followup-001");

    await client.bind({
      session_id: adopted.session.session_id,
      source_type: "browser",
      source_thread_key: sourceThreadKey
    });

    const first = await client.captureBrowserMessage({
      source_thread_key: sourceThreadKey,
      message_id: "browser-msg-duplicate",
      text: "This browser message may be retried."
    });
    const second = await client.captureBrowserMessage({
      source_thread_key: sourceThreadKey,
      message_id: "browser-msg-duplicate",
      text: "This browser message may be retried."
    });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);

    const runId = adopted.run?.run_id;
    assert.ok(runId);
    const paths = sessionPaths(sidecar.tempRoot, adopted.session.session_id, runId!);
    const events = await readJsonl<{ event_type: string }>(paths.sessionEvents);
    assert.equal(events.filter((event) => event.event_type === "message_received").length, 1);
  } finally {
    await sidecar.cleanup();
  }
});

test("browser connector rejects malformed payloads and unbound threads", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    await assert.rejects(
      client.captureBrowserMessage({
        source_thread_key: "",
        message_id: "browser-msg-invalid",
        text: "Missing stable thread."
      }),
      (error: unknown) =>
        error instanceof ManagerSidecarHttpError &&
        error.statusCode === 400 &&
        error.message.includes("source_thread_key")
    );

    await assert.rejects(
      client.captureBrowserMessage({
        source_thread_key: browserThreadKey("sidepanel", "unbound-001"),
        message_id: "browser-msg-unbound",
        text: "No binding exists yet."
      }),
      (error: unknown) =>
        error instanceof ManagerSidecarHttpError &&
        error.statusCode === 404
    );
  } finally {
    await sidecar.cleanup();
  }
});

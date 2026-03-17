import assert from "node:assert/strict";
import { test } from "node:test";

import { githubIssueThreadKey } from "../src/connectors/github.ts";
import { ManagerSidecarClient } from "../src/skill/sidecar-client.ts";
import { readJsonl, sessionPaths, startTempSidecar } from "./helpers.ts";

test("github issue_comment webhook normalizes into canonical inbound and resolves the session through binding", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const adopted = await client.adopt({
      title: "GitHub connector session",
      objective: "Verify GitHub comment events can flow through binding."
    });

    await client.bind({
      session_id: adopted.session.session_id,
      source_type: "github",
      source_thread_key: githubIssueThreadKey("openai/openclaw", 42)
    });

    const response = await fetch(`${sidecar.baseUrl}/connectors/github/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "issue_comment",
        "x-github-delivery": "gh-delivery-001"
      },
      body: JSON.stringify({
        action: "created",
        repository: {
          full_name: "openai/openclaw"
        },
        issue: {
          number: 42,
          title: "Manager binding flow",
          html_url: "https://github.com/openai/openclaw/issues/42"
        },
        comment: {
          id: 1001,
          body: "A bound GitHub comment arrived.",
          html_url: "https://github.com/openai/openclaw/issues/42#issuecomment-1001"
        },
        sender: {
          login: "octocat"
        }
      })
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      accepted: boolean;
      ignored: boolean;
      event: string;
      source_thread_key: string;
      duplicate: boolean;
      session: { session_id: string; activity: { queue: { state: string } } };
    };

    assert.equal(payload.accepted, true);
    assert.equal(payload.ignored, false);
    assert.equal(payload.event, "issue_comment");
    assert.equal(payload.source_thread_key, githubIssueThreadKey("openai/openclaw", 42));
    assert.equal(payload.duplicate, false);
    assert.equal(payload.session.session_id, adopted.session.session_id);
    assert.equal(payload.session.activity.queue.state, "pending");
  } finally {
    await sidecar.cleanup();
  }
});

test("github duplicate delivery ids do not re-emit message_received facts", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const adopted = await client.adopt({
      title: "GitHub duplicate delivery",
      objective: "Verify duplicate webhook deliveries are idempotent."
    });

    await client.bind({
      session_id: adopted.session.session_id,
      source_type: "github",
      source_thread_key: githubIssueThreadKey("openai/openclaw", 43)
    });

    const webhookBody = {
      action: "created",
      repository: {
        full_name: "openai/openclaw"
      },
      issue: {
        number: 43,
        title: "Idempotent delivery"
      },
      comment: {
        id: 1002,
        body: "This delivery may be retried."
      },
      sender: {
        login: "octocat"
      }
    };

    const first = await fetch(`${sidecar.baseUrl}/connectors/github/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "issue_comment",
        "x-github-delivery": "gh-delivery-duplicate"
      },
      body: JSON.stringify(webhookBody)
    });
    const second = await fetch(`${sidecar.baseUrl}/connectors/github/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "issue_comment",
        "x-github-delivery": "gh-delivery-duplicate"
      },
      body: JSON.stringify(webhookBody)
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await first.json() as { duplicate: boolean }).duplicate, false);
    assert.equal((await second.json() as { duplicate: boolean }).duplicate, true);

    const runId = adopted.run?.run_id;
    assert.ok(runId);
    const paths = sessionPaths(sidecar.tempRoot, adopted.session.session_id, runId!);
    const events = await readJsonl<{ event_type: string }>(paths.sessionEvents);
    assert.equal(events.filter((event) => event.event_type === "message_received").length, 1);
  } finally {
    await sidecar.cleanup();
  }
});

test("github ping and unsupported events are acknowledged as ignored instead of mutating manager state", async () => {
  const sidecar = await startTempSidecar();

  try {
    const ping = await fetch(`${sidecar.baseUrl}/connectors/github/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "ping",
        "x-github-delivery": "gh-delivery-ping"
      },
      body: JSON.stringify({
        zen: "Keep it logically awesome."
      })
    });

    assert.equal(ping.status, 202);
    const pingPayload = (await ping.json()) as {
      accepted: boolean;
      ignored: boolean;
      reason: string;
    };
    assert.equal(pingPayload.accepted, false);
    assert.equal(pingPayload.ignored, true);
    assert.equal(pingPayload.reason, "ping_event");

    const unsupported = await fetch(`${sidecar.baseUrl}/connectors/github/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "pull_request",
        "x-github-delivery": "gh-delivery-unsupported"
      },
      body: JSON.stringify({
        action: "opened"
      })
    });

    assert.equal(unsupported.status, 202);
    const unsupportedPayload = (await unsupported.json()) as {
      accepted: boolean;
      ignored: boolean;
      reason: string;
    };
    assert.equal(unsupportedPayload.accepted, false);
    assert.equal(unsupportedPayload.ignored, true);
    assert.equal(unsupportedPayload.reason, "unsupported_event");

    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const sessions = await client.listSessions();
    assert.equal(sessions.length, 0);
  } finally {
    await sidecar.cleanup();
  }
});

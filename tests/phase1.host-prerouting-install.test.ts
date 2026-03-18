import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  handleOpenClawManagerPreroutingEvent,
  type OpenClawManagerHookEvent
} from "../hooks/openclaw-manager-prerouting/handler.ts";
import { buildOpenClawManagerHostSetupPlan } from "../src/host/setup.ts";
import { createTempManager, dispatchRoute, startTempSidecar } from "./helpers.ts";
import { ManagerServer } from "../src/api/server.ts";

const repoRoot = "/Users/yangshangqing/metaclaw";

test("host setup plan installs and enables the managed pre-routing hook from this repo", () => {
  const plan = buildOpenClawManagerHostSetupPlan({
    repo_root: repoRoot,
    openclaw_bin: "openclaw",
    manager_base_url: "http://127.0.0.1:8791"
  });

  assert.equal(plan.hook_id, "openclaw-manager-prerouting");
  assert.equal(
    plan.hook_dir,
    path.join(repoRoot, "hooks", "openclaw-manager-prerouting")
  );
  assert.deepEqual(plan.enable_pre_routing.map((step) => step.argv), [
    ["openclaw", "hooks", "install", "-l", plan.hook_dir],
    ["openclaw", "hooks", "enable", "openclaw-manager-prerouting"]
  ]);
  assert.deepEqual(plan.disable_pre_routing.map((step) => step.argv), [
    ["openclaw", "hooks", "disable", "openclaw-manager-prerouting"]
  ]);
});

test("sidecar exposes canonical host prerouting over HTTP", async () => {
  const manager = await createTempManager();

  try {
    const server = new ManagerServer(
      manager.controlPlane,
      manager.config,
      manager.publicFactAutoSubmitService
    );
    const response = await dispatchRoute(server, "POST", "/host/prerouting", {
      text: "请帮我研究这个项目，后续持续跟进并整理交付。",
      source_type: "telegram",
      source_thread_key: "tg-prerouting-001",
      message_id: "msg-prerouting-001",
      received_at: "2026-03-18T10:00:00.000Z"
    });

    assert.equal(response.statusCode, 200);
    const payload = response.body as {
      action: string;
      session_console_url: string | null;
      manager: {
        outcome: string;
        target_session_id: string | null;
        inbound: { duplicate: boolean } | null;
      };
    };
    assert.equal(payload.action, "short_circuit_to_manager");
    assert.equal(payload.manager.outcome, "adopted_new_session");
    assert.equal(payload.session_console_url, null);
    assert.ok(payload.manager.target_session_id);
    assert.equal(payload.manager.inbound?.duplicate, false);
  } finally {
    await manager.cleanup();
  }
});

test("sidecar prerouting returns a published console url only when explicitly configured", async () => {
  const manager = await createTempManager({
    ui: {
      public_base_url: "https://manager.example.com"
    }
  });

  try {
    const server = new ManagerServer(
      manager.controlPlane,
      manager.config,
      manager.publicFactAutoSubmitService
    );
    const response = await dispatchRoute(server, "POST", "/host/prerouting", {
      text: "请帮我研究这个项目，后续持续跟进并整理交付。",
      source_type: "telegram",
      source_thread_key: "tg-prerouting-002",
      message_id: "msg-prerouting-002",
      received_at: "2026-03-18T10:00:00.000Z"
    });

    assert.equal(response.statusCode, 200);
    const payload = response.body as { session_console_url: string | null };
    assert.equal(payload.session_console_url, "https://manager.example.com/ui");
  } finally {
    await manager.cleanup();
  }
});

test("managed hook surfaces a suggestion message when manager recommends adopt", async () => {
  const event: OpenClawManagerHookEvent = {
    type: "message",
    action: "received",
    messages: [],
    context: {
      content: "请帮我研究这个项目，后续持续跟进并整理报告。",
      channelId: "telegram",
      conversationId: "tg-hook-001"
    }
  };

  await handleOpenClawManagerPreroutingEvent(event, {
    managerBaseUrl: "http://127.0.0.1:8791",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          action: "show_adopt_suggestion",
          session_console_url: null,
          manager: {
            outcome: "suggested",
            suggestion: {
              command: "/adopt",
              title: "研究这个项目...",
              note: "Reason: keyword_research, long_horizon_task"
            }
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
  });

  assert.equal(event.messages.length, 1);
  assert.match(event.messages[0]!, /OpenClaw Manager 建议/);
  assert.match(event.messages[0]!, /\/adopt/);
  assert.doesNotMatch(event.messages[0]!, /控制台：/);
});

test("managed hook suppresses duplicate direct-adopt notifications on retried messages", async () => {
  const event: OpenClawManagerHookEvent = {
    type: "message",
    action: "received",
    messages: [],
    context: {
      content: "继续跟进这个项目。",
      channelId: "telegram",
      conversationId: "tg-hook-002",
      messageId: "msg-duplicate-001"
    }
  };

  await handleOpenClawManagerPreroutingEvent(event, {
    managerBaseUrl: "http://127.0.0.1:8791",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          action: "short_circuit_to_manager",
          session_console_url: null,
          manager: {
            outcome: "routed_to_existing_session",
            target_session_id: "sess_existing",
            inbound: {
              duplicate: true
            }
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
  });

  assert.equal(event.messages.length, 0);
});

test("managed hook uses the live sidecar prerouting route end-to-end", async () => {
  const sidecar = await startTempSidecar();

  try {
    const event: OpenClawManagerHookEvent = {
      type: "message",
      action: "received",
      messages: [],
      context: {
        content: "请帮我研究这个项目，后续持续跟进并整理交付。",
        channelId: "telegram",
        conversationId: "tg-hook-live-001",
        messageId: "msg-hook-live-001"
      }
    };

    await handleOpenClawManagerPreroutingEvent(event, {
      managerBaseUrl: sidecar.baseUrl
    });

    assert.equal(event.messages.length, 1);
    assert.match(event.messages[0]!, /OpenClaw Manager 已收编/);
    assert.doesNotMatch(event.messages[0]!, /控制台：/);
  } finally {
    await sidecar.cleanup();
  }
});

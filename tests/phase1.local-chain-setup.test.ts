import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";

import {
  createDefaultLocalChainConfig,
  writeLocalChainConfig
} from "../src/host/local-chain.ts";
import { buildLocalSidecarServicePlan } from "../src/host/local-service.ts";
import { validatePublishedUiBaseUrl } from "../src/shared/ui.ts";
import {
  handleOpenClawManagerPreroutingEvent,
  type OpenClawManagerHookEvent
} from "../hooks/openclaw-manager-prerouting/handler.ts";

const repoRoot = "/Users/yangshangqing/metaclaw";

test("default local-chain config is local-first and keeps public facts opt-in", () => {
  const config = createDefaultLocalChainConfig();

  assert.equal(config.manager_base_url, "http://127.0.0.1:8791");
  assert.equal(config.sidecar.port, 8791);
  assert.match(config.sidecar.state_root, /\/\.openclaw\/skills\/manager$/);
  assert.equal(config.ui.public_base_url, null);
  assert.equal(config.hook.enabled, true);
  assert.equal(config.host_integration.mode, "managed_hook");
  assert.equal(config.host_integration.reason, null);
  assert.equal(config.public_facts.endpoint, "http://142.171.114.18:56557/v1/ingest");
  assert.equal(config.public_facts.auto_submit_enabled, false);
});

test("local sidecar service plan renders launchd and systemd-user targets", () => {
  const darwinPlan = buildLocalSidecarServicePlan({
    repo_root: repoRoot,
    config_path: "/tmp/openclaw-local-chain.json",
    platform: "darwin"
  });
  assert.equal(darwinPlan.service_kind, "launchd");
  assert.match(darwinPlan.service_path ?? "", /Library\/LaunchAgents\/ai\.openclaw\.manager\.local\.plist$/);
  assert.match(darwinPlan.content ?? "", /run-local-sidecar\.ts/);
  assert.match(darwinPlan.content ?? "", /OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG/);

  const linuxPlan = buildLocalSidecarServicePlan({
    repo_root: repoRoot,
    config_path: "/tmp/openclaw-local-chain.json",
    platform: "linux"
  });
  assert.equal(linuxPlan.service_kind, "systemd-user");
  assert.match(linuxPlan.service_path ?? "", /openclaw-manager-local\.service$/);
  assert.match(linuxPlan.content ?? "", /ExecStart=.*run-local-sidecar\.ts/);
  assert.match(linuxPlan.content ?? "", /OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG=/);
});

test("managed hook resolves manager base url from local-chain config when no explicit override exists", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openclaw-local-chain-"));
  const configPath = path.join(tempRoot, "local-chain.json");
  const previous = process.env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG;

  try {
    await writeLocalChainConfig(
      createDefaultLocalChainConfig({
        manager_base_url: "http://127.0.0.1:9911",
        public_facts: {
          auto_submit_enabled: true
        }
      }),
      configPath
    );
    process.env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG = configPath;

    const urls: string[] = [];
    const event: OpenClawManagerHookEvent = {
      type: "message",
      action: "received",
      messages: [],
      context: {
        content: "请帮我研究这个项目，后续持续跟进并整理报告。",
        channelId: "telegram",
        conversationId: "tg-local-chain-001"
      }
    };

    await handleOpenClawManagerPreroutingEvent(event, {
      fetchImpl: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            action: "show_adopt_suggestion",
            session_console_url: "http://127.0.0.1:9911/ui",
            manager: {
              outcome: "suggested",
              suggestion: {
                command: "/adopt"
              }
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
    });

    assert.equal(urls.length, 1);
    assert.equal(urls[0], "http://127.0.0.1:9911/host/prerouting");
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG;
    } else {
      process.env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG = previous;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("published UI base must not reuse sidecar or ingest surfaces", () => {
  assert.match(
    validatePublishedUiBaseUrl("http://142.171.114.18:8791", {
      manager_base_url: "http://127.0.0.1:8791",
      public_facts_endpoint: "http://142.171.114.18:56557/v1/ingest"
    }) ?? "",
    /must not point at the manager sidecar port/i
  );

  assert.match(
    validatePublishedUiBaseUrl("http://142.171.114.18:56557/v1/ingest", {
      manager_base_url: "http://127.0.0.1:8791",
      public_facts_endpoint: "http://142.171.114.18:56557/v1/ingest"
    }) ?? "",
    /must stay on a different public origin or port than the ingest service/i
  );

  assert.match(
    validatePublishedUiBaseUrl("http://142.171.114.18:56557/console", {
      manager_base_url: "http://127.0.0.1:8791",
      public_facts_endpoint: "http://142.171.114.18:56557/v1/ingest"
    }) ?? "",
    /must stay on a different public origin or port than the ingest service/i
  );

  assert.equal(
    validatePublishedUiBaseUrl("https://gateway.example.com/openclaw-manager", {
      manager_base_url: "http://127.0.0.1:8791",
      public_facts_endpoint: "http://142.171.114.18:56557/v1/ingest"
    }),
    null
  );
});

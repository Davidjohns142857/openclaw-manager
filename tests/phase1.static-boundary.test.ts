import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { ManagerServer } from "../src/api/server.ts";
import { managerCommands } from "../src/skill/commands.ts";
import { createTempManager, dispatchRoute, startTempSidecar } from "./helpers.ts";

const repoRoot = "/Users/yangshangqing/metaclaw";

function manifestCommands(manifest: string): string[] {
  return [...manifest.matchAll(/- "([^"]+)"/g)].map((match) => match[1].split(" ")[0]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("command registry matches skill manifest and skill instructions", async () => {
  const [manifest, skillMd] = await Promise.all([
    readFile(path.join(repoRoot, "skill.yaml"), "utf8"),
    readFile(path.join(repoRoot, "skills/openclaw-manager/SKILL.md"), "utf8")
  ]);
  const manifestCommandSet = new Set(manifestCommands(manifest));
  const registryCommandSet = new Set(managerCommands.map((command) => command.command));

  assert.deepEqual(registryCommandSet, manifestCommandSet);

  for (const command of registryCommandSet) {
    assert.match(skillMd, new RegExp(command.replace("/", "\\/")));
  }
});

test("root public skill bundle stays portable and local-first", async () => {
  const [rootSkill, rootInstall, rootAgent] = await Promise.all([
    readFile(path.join(repoRoot, "SKILL.md"), "utf8"),
    readFile(path.join(repoRoot, "INSTALL.md"), "utf8"),
    readFile(path.join(repoRoot, "agents/openai.yaml"), "utf8")
  ]);

  for (const snippet of [
    "user-invocable: true",
    "`{baseDir}/INSTALL.md`",
    "same-machine local sidecar skill",
    "Do not default to SSH",
    "OpenClaw Gateway locally",
    "`node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts`",
    "`node ~/.openclaw/tools/openclaw-manager/scripts/doctor-local-chain.ts`",
    "`--cloud-hosted`",
    "`--ui-public-base-url`",
    "must not reuse `56557/v1/ingest`",
    "`http://142.171.114.18:56557/v1/ingest`"
  ]) {
    assert.match(`${rootSkill}\n${rootInstall}\n${rootAgent}`, new RegExp(escapeRegExp(snippet)));
  }
});

test("all shipped schemas parse as valid JSON", async () => {
  const schemaFiles = [
    "schemas/session.schema.json",
    "schemas/run.schema.json",
    "schemas/event.schema.json",
    "schemas/checkpoint.schema.json",
    "schemas/skill-trace.schema.json",
    "schemas/attention-unit.schema.json",
    "schemas/capability-fact.schema.json",
    "schemas/local-distillation.schema.json",
    "schemas/fact-outbox-batch.schema.json",
    "schemas/fact-outbox-receipt.schema.json",
    "schemas/inbound-message.schema.json",
    "schemas/connector-binding.schema.json"
  ];

  for (const schemaFile of schemaFiles) {
    const raw = await readFile(path.join(repoRoot, schemaFile), "utf8");
    assert.doesNotThrow(() => JSON.parse(raw), schemaFile);
  }
});

test("run guarantees doc stays aligned with the recovery and focus baseline", async () => {
  const guarantees = await readFile(path.join(repoRoot, "docs/run-guarantees.md"), "utf8");

  for (const snippet of [
    "open：`accepted`、`queued`、`running`",
    "paused-terminal：`waiting_human`、`blocked`",
    "ended-terminal：`completed`、`failed`、`cancelled`、`superseded`",
    "`status=completed` 只允许 `outcome.result_type=completed | partial_progress | no_op`",
    "`status=waiting_human` 只允许 `outcome.result_type=waiting_human`",
    "`status=cancelled | superseded` 时 `outcome.result_type=null`，并且 `reason_code` 必填",
    "终态会推进 committed recovery head：`waiting_human`、`blocked`、`completed`",
    "终态不会推进 committed recovery head：`failed`、`cancelled`、`superseded`",
    "新 run 的 `start_checkpoint_ref` 优先指向最近一次推进过 head 的 `end_checkpoint_ref`",
    "面对 `waiting_human`：不自动开新 run；恢复 committed checkpoint；保留 checkpoint 之后进入的 inbound queue",
    "面对 `blocked`：不自动开新 run；恢复 committed checkpoint；保留 checkpoint 之后进入的 inbound queue",
    "面对 `failed`：恢复最近 committed checkpoint，然后创建新 run，`trigger_type=resume`",
    "`retry` / `resume` 总是创建新 run",
    "tests/phase2.run-lifecycle.test.ts"
  ]) {
    assert.match(guarantees, new RegExp(escapeRegExp(snippet)));
  }
});

test("local distillation doc stays aligned with the local-only aggregate baseline", async () => {
  const document = await readFile(path.join(repoRoot, "docs/local-distillation.md"), "utf8");

  for (const snippet of [
    "Input: durable terminal `session` state plus durable `run` history and durable `skill_trace` history.",
    "Output: one stable snapshot at `indexes/local_distillation.json`.",
    "Read surface: `GET /distillation/local`.",
    "Recompute surface: `POST /distill` and `/distill`.",
    "This layer is strictly node-local.",
    "formal [`CapabilityFact`]",
    "`closure_rate`",
    "`recovery_success_rate`",
    "`human_intervention_rate`",
    "`blocked_recurrence_rate`",
    "`run_trigger_rate`",
    "`invocation_count`",
    "`success_rate` / `failure_rate`",
    "`workflow_closure_rate`",
    "`workflow_efficiency`",
    "Only terminal sessions participate in the snapshot.",
    "Closing a session refreshes the local snapshot automatically.",
    "Each aggregate fact carries `aggregation_window` and `privacy`.",
    "Public ingest remains a future, separate pipeline",
    "tests/phase3.local-distillation.test.ts"
  ]) {
    assert.match(document, new RegExp(escapeRegExp(snippet)));
  }
});

test("capability fact and outbox docs stay aligned with the submission baseline", async () => {
  const [factDoc, outboxDoc] = await Promise.all([
    readFile(path.join(repoRoot, "docs/capability-fact-contract.md"), "utf8"),
    readFile(path.join(repoRoot, "docs/public-facts-outbox.md"), "utf8")
  ]);

  for (const snippet of [
    "`fact_kind`",
    "`subject`",
    "`aggregation_window`",
    "`privacy`",
    "raw node facts are `export_policy=local_only`",
    "aggregated node/scenario/skill/workflow facts are `export_policy=public_submit_allowed`",
    "`pending`",
    "`claimed`",
    "`acked`",
    "`failed_retryable`",
    "`dead_letter`",
    "Duplicate is treated as logical success",
    "Retrying the same batch must keep `batch_id` and `content_hash` unchanged.",
    "`dry-run`",
    "`local-file`",
    "`mock-http`",
    "`http`",
    "`POST /public-facts/submit`",
    "`/submit-public-facts`",
    "tests/phase3.public-fact-submission.test.ts"
  ]) {
    assert.match(`${factDoc}\n${outboxDoc}`, new RegExp(escapeRegExp(snippet)));
  }
});

test("public fact auto submit doc stays aligned with the background submit baseline", async () => {
  const document = await readFile(path.join(repoRoot, "docs/public-fact-auto-submit.md"), "utf8");

  for (const snippet of [
    "Auto submit is a sidecar background task.",
    "It only uses `mode=http`.",
    "It periodically runs `distill -> submitPublicFacts(mode=http)`.",
    "`auto_submit_enabled`",
    "`auto_submit_interval_ms`",
    "`GET /health` exposes:",
    "`public_facts.auto_submit.enabled`",
    "`public_facts.auto_submit.last_result`",
    "tests/phase3.public-fact-auto-submit.test.ts"
  ]) {
    assert.match(document, new RegExp(escapeRegExp(snippet)));
  }
});

test("host pre-routing hook doc stays aligned with the admission boundary", async () => {
  const [document, cloudBoundary] = await Promise.all([
    readFile(path.join(repoRoot, "docs/openclaw-host-prerouting-hook.md"), "utf8"),
    readFile(path.join(repoRoot, "docs/cloud-deploy-boundary.md"), "utf8")
  ]);

  for (const snippet of [
    "只安装 skill，不会自动把所有普通消息劫持到 manager。",
    "`allow_implicit_invocation` 也不等于 pre-routing hook。",
    "如果不是显式命令，再执行 manager pre-routing hook",
    "`collectHostContext(...)`",
    "`shouldSuggestAdopt(...)`",
    "`suggestOrAdopt(...)`",
    "`do_nothing`：继续走原来的默认 skill / router",
    "`suggest_adopt`：向用户提示 `/adopt`",
    "直接走 manager canonical ingress，并短路默认 skill 路由",
    "`OPENCLAW_MANAGER_BASE_URL=http://127.0.0.1:8791`",
    "`source_type`",
    "`source_thread_key`",
    "`message_id`",
    "手动 `/adopt` 工作流",
    "把 manager sidecar 绑定到 `0.0.0.0`",
    "绝不能是 sidecar 原生端口",
    "OpenClaw Gateway 默认 WebUI 在 `127.0.0.1:18789`"
  ]) {
    assert.match(`${document}\n${cloudBoundary}`, new RegExp(escapeRegExp(snippet)));
  }
});

test("install guide stays aligned with hook setup and public fact verification surfaces", async () => {
  const [skillMd, installMd] = await Promise.all([
    readFile(path.join(repoRoot, "skills/openclaw-manager/SKILL.md"), "utf8"),
    readFile(path.join(repoRoot, "skills/openclaw-manager/INSTALL.md"), "utf8")
  ]);

  for (const snippet of [
    "`metadata.openclaw.install`",
    "`~/.openclaw/tools/openclaw-manager`",
    "`node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts`",
    "`node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts --cloud-hosted`",
    "`node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-host.ts`",
    "`--ui-public-base-url https://your-manager.example.com`",
    "`openclaw hooks install -l`",
    "`openclaw hooks enable openclaw-manager-prerouting`",
    "`http://127.0.0.1:8791`",
    "`http://142.171.114.18:56557/v1/ingest`",
    "`http://142.171.114.18:56557/v1/health`",
    "`http://142.171.114.18:56557/v1/facts`"
  ]) {
    assert.match(`${skillMd}\n${installMd}`, new RegExp(escapeRegExp(snippet)));
  }
});

test("session console frontend doc stays aligned with timeline and outbox surfaces", async () => {
  const document = await readFile(path.join(repoRoot, "ui/session-console/FRONTEND.md"), "utf8");

  for (const snippet of [
    "`ui.session_console_url`",
    "`ui.local_session_console_url`",
    "`GET /sessions/:id/timeline`",
    "\"result_type\": \"completed | partial_progress | waiting_human | failed | null\"",
    "`GET /public-facts/outbox`",
    "`POST /public-facts/submit`",
    "当前页面应直接消费 `GET /sessions/:id/timeline`"
  ]) {
    assert.match(document, new RegExp(escapeRegExp(snippet)));
  }
});

test("sidecar exposes the same-origin session console and advertises its url", async () => {
  const manager = await startTempSidecar();

  try {
    const healthResponse = await fetch(`${manager.baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    const health = (await healthResponse.json()) as {
      ui?: {
        session_console_url?: string | null;
        local_session_console_url?: string;
        access_mode?: string;
      };
      port?: number;
    };
    assert.equal(health.ui?.session_console_url, null);
    assert.equal(health.ui?.local_session_console_url, `${manager.baseUrl}/ui`);
    assert.equal(health.ui?.access_mode, "local_only");

    const uiResponse = await fetch(`${manager.baseUrl}/ui`);
    assert.equal(uiResponse.status, 200);
    assert.match(uiResponse.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await uiResponse.text(), /OpenClaw Session Console/);

    const appResponse = await fetch(`${manager.baseUrl}/ui/src/app.js`);
    assert.equal(appResponse.status, 200);
    assert.match(appResponse.headers.get("content-type") ?? "", /application\/javascript/);
    assert.match(await appResponse.text(), /router\.on/);
  } finally {
    await manager.cleanup();
  }
});

test("health exposes a published console url only when explicitly configured", async () => {
  const manager = await startTempSidecar({
    ui: {
      public_base_url: "https://manager.example.com"
    }
  });

  try {
    const healthResponse = await fetch(`${manager.baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    const health = (await healthResponse.json()) as {
      ui?: {
        session_console_url?: string | null;
        local_session_console_url?: string;
        access_mode?: string;
      };
    };
    assert.equal(health.ui?.session_console_url, "https://manager.example.com/ui");
    assert.equal(health.ui?.local_session_console_url, `${manager.baseUrl}/ui`);
    assert.equal(health.ui?.access_mode, "external");
  } finally {
    await manager.cleanup();
  }
});

test("manual-adopt plus auto-submit derives a published console url from the public facts host", async () => {
  const manager = await createTempManager({
    host_integration: {
      mode: "manual_adopt",
      reason: "cloud_gateway_unavailable"
    },
    public_facts: {
      auto_submit_enabled: true,
      endpoint: "http://142.171.114.18:56557/v1/ingest"
    }
  });

  try {
    const server = new ManagerServer(
      manager.controlPlane,
      manager.config,
      manager.publicFactAutoSubmitService
    );
    const healthResponse = await dispatchRoute(server, "GET", "/health");
    assert.equal(healthResponse.statusCode, 200);
    const health = healthResponse.body as {
      ui?: {
        session_console_url?: string | null;
        access_mode?: string;
        publish_proxy?: {
          enabled?: boolean;
          port?: number | null;
        };
      };
    };
    assert.equal(health.ui?.session_console_url, "http://142.171.114.18:18891/ui");
    assert.equal(health.ui?.access_mode, "published_proxy");
    assert.equal(health.ui?.publish_proxy?.enabled, true);
    assert.equal(health.ui?.publish_proxy?.port, 18891);
  } finally {
    await manager.cleanup();
  }
});

test("server route layer exports canonical session activity and command boundary works", async () => {
  const manager = await createTempManager();

  try {
    const server = new ManagerServer(manager.controlPlane, manager.config);
    const adoptResponse = await dispatchRoute(server, "POST", "/adopt", {
      title: "Route boundary check",
      objective: "Verify server/control-plane alignment."
    });

    assert.equal(adoptResponse.statusCode, 200);
    const adopted = adoptResponse.body as { session: { session_id: string; activity: unknown } };
    assert.ok(adopted.session.activity);

    const sessionsResponse = await dispatchRoute(server, "GET", "/sessions");
    assert.equal(sessionsResponse.statusCode, 200);

    const sessions = sessionsResponse.body as Array<Record<string, unknown>>;
    assert.equal(sessions.length, 1);
    assert.ok((sessions[0].activity as Record<string, unknown>).run);

    const detailResponse = await dispatchRoute(
      server,
      "GET",
      `/sessions/${adopted.session.session_id}`
    );
    assert.equal(detailResponse.statusCode, 200);
    const detail = detailResponse.body as { session: Record<string, unknown> };
    assert.ok(detail.session.activity);

    const timelineResponse = await dispatchRoute(
      server,
      "GET",
      `/sessions/${adopted.session.session_id}/timeline`
    );
    assert.equal(timelineResponse.statusCode, 200);
    const timeline = timelineResponse.body as {
      contract_id: string;
      session: { session_id: string };
      runs: Array<{ run_id: string; trigger: { trigger_type: string } }>;
    };
    assert.equal(timeline.contract_id, "session_run_timeline_v1");
    assert.equal(timeline.session.session_id, adopted.session.session_id);
    assert.equal(timeline.runs.length, 1);
    assert.equal(timeline.runs[0]?.trigger.trigger_type, "manual");

    const bindResponse = await dispatchRoute(server, "POST", "/bind", {
      session_id: adopted.session.session_id,
      source_type: "telegram",
      source_thread_key: "tg_route_bound_001"
    });
    assert.equal(bindResponse.statusCode, 200);
    const bound = bindResponse.body as { binding: { binding_id: string } };
    assert.ok(bound.binding);

    const filteredBindingsResponse = await dispatchRoute(
      server,
      "GET",
      `/bindings?status=active&session_id=${adopted.session.session_id}`
    );
    assert.equal(filteredBindingsResponse.statusCode, 200);
    assert.equal((filteredBindingsResponse.body as Array<unknown>).length, 1);

    const inboundResponse = await dispatchRoute(server, "POST", "/inbound-message", {
      request_id: "req_route_001",
      source_type: "telegram",
      source_thread_key: "tg_route_bound_001",
      message_type: "user_message",
      content: "Route-level inbound test."
    });
    assert.equal(inboundResponse.statusCode, 200);
    const inbound = inboundResponse.body as Record<string, unknown>;
    assert.equal(inbound.duplicate, false);
    assert.ok(inbound.session);

    const reboundTarget = await dispatchRoute(server, "POST", "/adopt", {
      title: "Route rebound target",
      objective: "Verify binding lifecycle routes stay aligned."
    });
    assert.equal(reboundTarget.statusCode, 200);
    const reboundSessionId = (reboundTarget.body as { session: { session_id: string } }).session
      .session_id;

    const rebindResponse = await dispatchRoute(
      server,
      "POST",
      `/bindings/${bound.binding.binding_id}/rebind`,
      {
        session_id: reboundSessionId
      }
    );
    assert.equal(rebindResponse.statusCode, 200);
    assert.equal(
      (rebindResponse.body as { binding: { session_id: string } }).binding.session_id,
      reboundSessionId
    );

    const disableResponse = await dispatchRoute(
      server,
      "POST",
      `/bindings/${bound.binding.binding_id}/disable`,
      {
        reason: "route boundary disable"
      }
    );
    assert.equal(disableResponse.statusCode, 200);
    assert.equal(
      (disableResponse.body as { binding: { status: string } }).binding.status,
      "disabled"
    );

    const resumeResponse = await dispatchRoute(
      server,
      "POST",
      `/sessions/${adopted.session.session_id}/resume`
    );
    assert.equal(resumeResponse.statusCode, 200);
    assert.ok((resumeResponse.body as { session: { activity: unknown } }).session.activity);

    const checkpointResponse = await dispatchRoute(
      server,
      "POST",
      `/sessions/${adopted.session.session_id}/checkpoint`
    );
    assert.equal(checkpointResponse.statusCode, 200);
    assert.ok((checkpointResponse.body as { session: { activity: unknown } }).session.activity);

    const closeResponse = await dispatchRoute(
      server,
      "POST",
      `/sessions/${adopted.session.session_id}/close`,
      {
        outcome_summary: "Close through route boundary test."
      }
    );
    assert.equal(closeResponse.statusCode, 200);
    assert.ok((closeResponse.body as { session: { activity: unknown } }).session.activity);

    const localDistillationResponse = await dispatchRoute(server, "GET", "/distillation/local");
    assert.equal(localDistillationResponse.statusCode, 200);
    const snapshot = localDistillationResponse.body as {
      contract_id: string;
      source_session_count: number;
      facts: unknown[];
    };
    assert.equal(snapshot.contract_id, "local_distillation_v1");
    assert.equal(snapshot.source_session_count, 1);
    assert.ok(snapshot.facts.length >= 1);

    const recomputedResponse = await dispatchRoute(server, "POST", "/distill");
    assert.equal(recomputedResponse.statusCode, 200);
    assert.equal(
      (recomputedResponse.body as { contract_id: string }).contract_id,
      "local_distillation_v1"
    );
  } finally {
    await manager.cleanup();
  }
});

test("filesystem store rejects writes that violate shipped schemas", async () => {
  const manager = await createTempManager();

  try {
    await assert.rejects(() => manager.store.writeSession({ session_id: "sess_bad" } as never));
  } finally {
    await manager.cleanup();
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { ManagerServer } from "../src/api/server.ts";
import { managerCommands } from "../src/skill/commands.ts";
import { createTempManager, dispatchRoute } from "./helpers.ts";

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

test("all shipped schemas parse as valid JSON", async () => {
  const schemaFiles = [
    "schemas/session.schema.json",
    "schemas/run.schema.json",
    "schemas/event.schema.json",
    "schemas/checkpoint.schema.json",
    "schemas/skill-trace.schema.json",
    "schemas/attention-unit.schema.json",
    "schemas/capability-fact.schema.json",
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
    "终态会推进 committed recovery head：`waiting_human`、`blocked`、`completed`",
    "终态不会推进 committed recovery head：`failed`、`cancelled`、`superseded`",
    "面对 `waiting_human`：不自动开新 run；恢复 committed checkpoint；保留 checkpoint 之后进入的 inbound queue",
    "面对 `blocked`：不自动开新 run；恢复 committed checkpoint；保留 checkpoint 之后进入的 inbound queue",
    "面对 `failed`：恢复最近 committed checkpoint，然后创建新 run，`trigger_type=resume`",
    "`retry` / `resume` 总是创建新 run",
    "tests/phase2.run-lifecycle.test.ts"
  ]) {
    assert.match(guarantees, new RegExp(escapeRegExp(snippet)));
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

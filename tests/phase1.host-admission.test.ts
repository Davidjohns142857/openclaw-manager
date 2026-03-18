import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleBasedHostAdmissionPolicy } from "../src/host/admission-policy.ts";
import { collectHostContext, type HostCapturedMessage } from "../src/host/context.ts";
import { runOpenClawManagerPreRoutingHook } from "../src/host/prerouting-hook.ts";
import { suggestOrAdopt } from "../src/host/suggest-or-adopt.ts";
import { deriveSessionActivity } from "../src/shared/activity.ts";
import type { Session } from "../src/shared/types.ts";
import { ManagerSidecarClient } from "../src/skill/sidecar-client.ts";
import { readJsonl, sessionPaths, startTempSidecar } from "./helpers.ts";

function buildSession(overrides: Partial<Session> = {}) {
  const base: Session = {
    session_id: "sess_host_001",
    title: "默认任务",
    objective: "默认目标",
    owner: {
      type: "human",
      ref: "user_primary"
    },
    status: "active",
    lifecycle_stage: "execution",
    priority: "medium",
    scenario_signature: null,
    tags: [],
    source_channels: [],
    active_run_id: null,
    latest_summary_ref: "summary.md",
    latest_checkpoint_ref: null,
    state: {
      phase: "execution",
      goal_status: "in_progress",
      blockers: [],
      pending_human_decisions: [],
      pending_external_inputs: [],
      next_machine_actions: [],
      next_human_actions: []
    },
    metrics: {
      run_count: 0,
      failed_run_count: 0,
      human_intervention_count: 0,
      artifact_count: 0,
      last_activity_at: "2026-03-17T00:00:00.000Z"
    },
    sharing: {
      is_shareable: true,
      latest_snapshot_id: null
    },
    created_at: "2026-03-17T00:00:00.000Z",
    updated_at: "2026-03-17T00:00:00.000Z",
    archived_at: null,
    metadata: {
      pending_inbound_count: 0,
      summary_needs_refresh: false
    }
  };

  const session: Session = {
    ...base,
    ...overrides,
    owner: {
      ...base.owner,
      ...(overrides.owner ?? {})
    },
    state: {
      ...base.state,
      ...(overrides.state ?? {})
    },
    metrics: {
      ...base.metrics,
      ...(overrides.metrics ?? {})
    },
    sharing: {
      ...base.sharing,
      ...(overrides.sharing ?? {})
    },
    metadata: {
      ...base.metadata,
      ...(overrides.metadata ?? {})
    }
  };

  return {
    ...session,
    activity: deriveSessionActivity(session, null)
  };
}

test("host context finds exact source-thread matches and policy allows direct manager ingress", async () => {
  const client = {
    async listSessions() {
      return [
        buildSession({
          session_id: "sess_existing",
          title: "Research Remotelab integration",
          objective: "持续跟进 remotelab 的集成研究",
          source_channels: [
            {
              source_type: "openclaw_plugin",
              source_ref: "thread-001",
              bound_at: "2026-03-17T00:00:00.000Z"
            }
          ]
        })
      ];
    },
    async focus() {
      return [];
    }
  };

  const message: HostCapturedMessage = {
    text: "继续跟进这个研究任务，后续整理报告。",
    source_type: "openclaw_plugin",
    source_thread_key: "thread-001",
    message_id: "msg-thread-001"
  };
  const context = await collectHostContext(client, message);
  const assessment = new RuleBasedHostAdmissionPolicy().assess(context);

  assert.equal(context.existing_session_match?.match_type, "source_thread");
  assert.equal(assessment.decision, "direct_adopt");
  assert.deepEqual(assessment.reason_codes, ["existing_source_thread_match"]);
});

test("exact source-thread matches still degrade to suggestion when message_id is missing", async () => {
  const client = {
    async listSessions() {
      return [
        buildSession({
          session_id: "sess_existing",
          title: "Research Remotelab integration",
          objective: "持续跟进 remotelab 的集成研究",
          source_channels: [
            {
              source_type: "openclaw_plugin",
              source_ref: "thread-001",
              bound_at: "2026-03-17T00:00:00.000Z"
            }
          ]
        })
      ];
    },
    async focus() {
      return [];
    }
  };

  const message: HostCapturedMessage = {
    text: "继续跟进这个研究任务，后续整理报告。",
    source_type: "openclaw_plugin",
    source_thread_key: "thread-001"
  };
  const context = await collectHostContext(client, message);
  const assessment = new RuleBasedHostAdmissionPolicy().assess(context);

  assert.equal(context.existing_session_match?.match_type, "source_thread");
  assert.equal(context.capture_key, null);
  assert.equal(assessment.decision, "suggest_adopt");
  assert.match(assessment.reason_codes.join(","), /missing_message_id/);
});

test("semantic overlap only suggests adopt and does not authorize implicit session merge", async () => {
  const client = {
    async listSessions() {
      return [
        buildSession({
          session_id: "sess_existing",
          title: "研究恢复语义",
          objective: "跟进 checkpoint 和 summary 的恢复顺序",
          tags: ["research", "recovery"]
        })
      ];
    },
    async focus() {
      return [];
    }
  };

  const message: HostCapturedMessage = {
    text: "继续研究恢复顺序，后续整理文档。",
    source_type: "openclaw_plugin",
    source_thread_key: "thread-new"
  };
  const context = await collectHostContext(client, message);
  const assessment = new RuleBasedHostAdmissionPolicy().assess(context);

  assert.equal(context.existing_session_match?.match_type, "keyword_overlap");
  assert.equal(assessment.decision, "suggest_adopt");
  assert.match(assessment.reason_codes.join(","), /existing_keyword_overlap/);
});

test("host admission only suggests adopt when the message lacks a stable source-thread id", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const result = await suggestOrAdopt(client, {
      text: "请帮我研究这个任务，后续持续跟进并整理报告。",
      source_type: "openclaw_plugin"
    });

    assert.equal(result.outcome, "suggested");
    assert.equal(result.assessment.decision, "suggest_adopt");
    assert.equal(result.adopted, null);
    assert.equal(result.inbound, null);
    assert.ok(result.suggestion);

    const sessions = await client.listSessions();
    assert.equal(sessions.length, 0);
  } finally {
    await sidecar.cleanup();
  }
});

test("host admission only suggests adopt when message_id is missing even if source_thread exists", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const result = await suggestOrAdopt(client, {
      text: "请帮我研究这个项目，后续持续跟进外部审批并整理报告。",
      source_type: "openclaw_plugin",
      source_thread_key: "plugin-thread-no-msgid"
    });

    assert.equal(result.outcome, "suggested");
    assert.equal(result.assessment.decision, "suggest_adopt");
    assert.match(result.assessment.reason_codes.join(","), /missing_message_id/);

    const sessions = await client.listSessions();
    assert.equal(sessions.length, 0);
  } finally {
    await sidecar.cleanup();
  }
});

test("host admission adopts a new session and captures the original host message through adopt plus inbound", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const result = await suggestOrAdopt(client, {
      text: "请帮我研究这个项目，后续持续跟进外部审批并整理报告。",
      source_type: "openclaw_plugin",
      source_thread_key: "plugin-thread-001",
      message_id: "msg-001",
      received_at: "2026-03-17T10:00:00.000Z"
    });

    assert.equal(result.outcome, "adopted_new_session");
    assert.equal(result.assessment.decision, "direct_adopt");
    assert.ok(result.adopted);
    assert.ok(result.inbound);
    assert.equal(result.target_session_id, result.adopted?.session.session_id);
    assert.equal(result.inbound?.session.session_id, result.adopted?.session.session_id);
    assert.equal(result.inbound?.queued, true);
    assert.equal(result.inbound?.session.activity.queue.state, "pending");
    assert.equal(result.adopted?.session.source_channels[0]?.source_ref, "plugin-thread-001");
    assert.equal(result.adopted?.session.metadata.created_via, "host_message_capture");

    const runId = result.adopted?.run?.run_id;
    assert.ok(runId);
    const paths = sessionPaths(sidecar.tempRoot, result.adopted!.session.session_id, runId!);
    const events = await readJsonl<{ event_type: string }>(paths.sessionEvents);
    assert.ok(events.some((event) => event.event_type === "message_received"));
  } finally {
    await sidecar.cleanup();
  }
});

test("host admission routes follow-up messages from the same source thread into the existing session", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const first = await suggestOrAdopt(client, {
      text: "请帮我研究这个项目，后续持续跟进外部审批并整理报告。",
      source_type: "openclaw_plugin",
      source_thread_key: "plugin-thread-002",
      message_id: "msg-002",
      received_at: "2026-03-17T10:00:00.000Z"
    });
    const second = await suggestOrAdopt(client, {
      text: "继续跟进这件事，等待审批后整理交付文档。",
      source_type: "openclaw_plugin",
      source_thread_key: "plugin-thread-002",
      message_id: "msg-003",
      received_at: "2026-03-17T11:00:00.000Z"
    });

    assert.equal(first.outcome, "adopted_new_session");
    assert.equal(second.outcome, "routed_to_existing_session");
    assert.equal(second.target_session_id, first.target_session_id);
    assert.equal(second.inbound?.session.session_id, first.target_session_id);

    const sessions = await client.listSessions();
    assert.equal(sessions.length, 1);

    const runId = first.adopted?.run?.run_id;
    assert.ok(runId);
    const paths = sessionPaths(sidecar.tempRoot, first.target_session_id!, runId!);
    const events = await readJsonl<{ event_type: string }>(paths.sessionEvents);
    assert.equal(events.filter((event) => event.event_type === "message_received").length, 2);
  } finally {
    await sidecar.cleanup();
  }
});

test("host message retry with the same source/thread/message id does not create a second session or duplicate inbound facts", async () => {
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });
    const original = {
      text: "请帮我研究这个项目，后续持续跟进外部审批并整理报告。",
      source_type: "openclaw_plugin",
      source_thread_key: "plugin-thread-retry",
      message_id: "msg-retry-001",
      received_at: "2026-03-17T10:00:00.000Z"
    } satisfies HostCapturedMessage;

    const first = await suggestOrAdopt(client, original);
    const retry = await suggestOrAdopt(client, {
      ...original,
      text: "请帮我研究这个项目，后续持续跟进外部审批并整理报告。  ",
      received_at: "2026-03-17T10:05:00.000Z"
    });

    assert.equal(first.outcome, "adopted_new_session");
    assert.equal(retry.outcome, "routed_to_existing_session");
    assert.equal(retry.target_session_id, first.target_session_id);
    assert.equal(retry.inbound?.duplicate, true);

    const sessions = await client.listSessions();
    assert.equal(sessions.length, 1);

    const runId = first.adopted?.run?.run_id;
    assert.ok(runId);
    const paths = sessionPaths(sidecar.tempRoot, first.target_session_id!, runId!);
    const events = await readJsonl<{ event_type: string }>(paths.sessionEvents);
    assert.equal(events.filter((event) => event.event_type === "message_received").length, 1);
  } finally {
    await sidecar.cleanup();
  }
});

test("pre-routing helper maps suggestion to a host-visible suggestion action and only exposes an explicitly provided console url", async () => {
  const sidecar = await startTempSidecar();

  try {
    const result = await runOpenClawManagerPreRoutingHook(
      {
        text: "请帮我研究这个项目，后续持续跟进外部审批并整理报告。",
        source_type: "openclaw_plugin"
      },
      {
        sidecar_base_url: sidecar.baseUrl,
        session_console_url: "https://manager.example.com/ui"
      }
    );

    assert.equal(result.action, "show_adopt_suggestion");
    assert.equal(result.manager.outcome, "suggested");
    assert.equal(result.session_console_url, "https://manager.example.com/ui");
    assert.ok(result.manager.suggestion);
  } finally {
    await sidecar.cleanup();
  }
});

test("pre-routing helper short-circuits to manager when direct admission is safe", async () => {
  const sidecar = await startTempSidecar();

  try {
    const result = await runOpenClawManagerPreRoutingHook(
      {
        text: "请帮我研究这个项目，后续持续跟进外部审批并整理报告。",
        source_type: "openclaw_plugin",
        source_thread_key: "plugin-thread-hook-001",
        message_id: "msg-hook-001",
        received_at: "2026-03-17T12:00:00.000Z"
      },
      {
        sidecar_base_url: sidecar.baseUrl
      }
    );

    assert.equal(result.action, "short_circuit_to_manager");
    assert.equal(result.manager.outcome, "adopted_new_session");
    assert.equal(result.session_console_url, null);
    assert.ok(result.manager.target_session_id);
  } finally {
    await sidecar.cleanup();
  }
});

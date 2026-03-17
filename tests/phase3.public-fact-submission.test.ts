import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { ManagerServer } from "../src/api/server.ts";
import { executeManagerCommand } from "../src/skill/commands.ts";
import type {
  CapabilityFactOutboxBatch,
  CapabilityFactOutboxReceipt
} from "../src/shared/types.ts";
import { createTempManager, dispatchRoute, pathExists } from "./helpers.ts";

async function closeOneExportableSession(
  manager: Awaited<ReturnType<typeof createTempManager>>
): Promise<void> {
  const adopted = await manager.controlPlane.adoptSession({
    title: "Public fact submission seed",
    objective: "Produce exportable local aggregate facts.",
    scenario_signature: "scenario.export"
  });

  await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
    status: "completed",
    summary: "Seed run completed.",
    reason_code: "seed_done"
  });
  await manager.controlPlane.closeSession(adopted.session.session_id, {
    outcome_summary: "Seed session closed."
  });
}

async function closeOneExportableSkillWorkflowSession(
  manager: Awaited<ReturnType<typeof createTempManager>>
): Promise<void> {
  const adopted = await manager.controlPlane.adoptSession({
    title: "Skill fact submission seed",
    objective: "Produce exportable skill/workflow aggregate facts.",
    scenario_signature: "scenario.export.skills"
  });

  await manager.controlPlane.runService.recordSkillInvocation(
    adopted.session.session_id,
    adopted.run.run_id,
    "research-skill"
  );
  await manager.controlPlane.runService.recordSkillInvocation(
    adopted.session.session_id,
    adopted.run.run_id,
    "summarizer"
  );
  await manager.controlPlane.skillTraceService.record({
    session_id: adopted.session.session_id,
    run_id: adopted.run.run_id,
    skill_name: "research-skill",
    skill_version: "1.0.0",
    duration_ms: 120,
    success: true,
    contribution_type: "primary",
    closure_contribution_score: 0.7
  });
  await manager.controlPlane.skillTraceService.record({
    session_id: adopted.session.session_id,
    run_id: adopted.run.run_id,
    skill_name: "summarizer",
    skill_version: "2.1.0",
    duration_ms: 60,
    success: true,
    contribution_type: "supporting",
    closure_contribution_score: 0.2
  });
  await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
    status: "completed",
    summary: "Skill export seed completed.",
    reason_code: "seed_done"
  });
  await manager.controlPlane.closeSession(adopted.session.session_id, {
    outcome_summary: "Skill export seed closed."
  });
}

async function requireBatchDetail(
  manager: Awaited<ReturnType<typeof createTempManager>>,
  batchId: string
): Promise<{ batch: CapabilityFactOutboxBatch; receipts: CapabilityFactOutboxReceipt[] }> {
  const detail = await manager.controlPlane.getFactOutboxBatch(batchId);
  assert.ok(detail);
  return detail;
}

test("dry-run keeps batching deterministic and does not mutate the outbox", async () => {
  const manager = await createTempManager();

  try {
    await closeOneExportableSession(manager);

    const first = await manager.controlPlane.submitPublicFacts({
      mode: "dry-run",
      max_batch_size: 2
    });
    const second = await manager.controlPlane.submitPublicFacts({
      mode: "dry-run",
      max_batch_size: 2
    });

    assert.equal(first.dry_run, true);
    assert.equal(first.created_batch_count, 3);
    assert.equal(first.submitted_batch_count, 0);
    assert.deepEqual(
      first.batches.map((batch) => batch.batch_id),
      second.batches.map((batch) => batch.batch_id)
    );
    assert.deepEqual(
      first.batches.map((batch) => batch.content_hash),
      second.batches.map((batch) => batch.content_hash)
    );
    assert.equal((await manager.controlPlane.listFactOutboxBatches()).length, 0);
    assert.equal(
      await pathExists(path.join(manager.tempRoot, "exports", "public-facts-outbox")),
      false
    );
  } finally {
    await manager.cleanup();
  }
});

test("local-file submission acks batches once and does not repackage the same facts", async () => {
  const manager = await createTempManager();

  try {
    await closeOneExportableSession(manager);

    const first = await manager.controlPlane.submitPublicFacts({
      mode: "local-file",
      max_batch_size: 2
    });
    assert.equal(first.created_batch_count, 3);
    assert.equal(first.submitted_batch_count, 3);
    assert.ok(first.batches.every((batch) => batch.state === "acked"));

    const batches = await manager.controlPlane.listFactOutboxBatches();
    assert.equal(batches.length, 3);
    assert.ok(batches.every((batch) => batch.state === "acked"));

    const detail = await requireBatchDetail(manager, first.batches[0]!.batch_id);
    assert.equal(detail.receipts[0]?.result, "claimed");
    assert.equal(detail.receipts[1]?.result, "accepted");
    assert.match(String(detail.receipts[1]?.transport_reference), /local-file/);

    const second = await manager.controlPlane.submitPublicFacts({
      mode: "local-file",
      max_batch_size: 2
    });
    assert.equal(second.created_batch_count, 0);
    assert.equal(second.submitted_batch_count, 0);
    assert.equal((await manager.controlPlane.listFactOutboxBatches()).length, 3);
  } finally {
    await manager.cleanup();
  }
});

test("skill and workflow aggregate facts are selected into the existing outbox pipeline", async () => {
  const manager = await createTempManager();

  try {
    await closeOneExportableSkillWorkflowSession(manager);

    const result = await manager.controlPlane.submitPublicFacts({
      mode: "local-file",
      max_batch_size: 50
    });
    assert.ok(result.created_batch_count >= 1);
    assert.ok(result.submitted_batch_count >= 1);

    const batches = await manager.controlPlane.listFactOutboxBatches();
    const exportedFacts = batches.flatMap((batch) => batch.facts);

    assert.ok(
      exportedFacts.some(
        (fact) =>
          fact.subject.subject_type === "skill" &&
          fact.subject.subject_ref === "research-skill" &&
          fact.metric_name === "invocation_count"
      )
    );
    assert.ok(
      exportedFacts.some(
        (fact) =>
          fact.subject.subject_type === "workflow" &&
          fact.subject.subject_ref === "research-skill|summarizer" &&
          fact.metric_name === "workflow_closure_rate"
      )
    );
    assert.ok(exportedFacts.every((fact) => fact.privacy.export_policy === "public_submit_allowed"));
  } finally {
    await manager.cleanup();
  }
});

test("http submission posts a public batch to the configured live endpoint and records ack receipts", async () => {
  const received: Array<{
    url: string;
    headers: Headers;
    body: unknown;
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const rawBody = typeof init?.body === "string" ? init.body : "";
    const body = rawBody ? JSON.parse(rawBody) : null;
    received.push({
      url: typeof input === "string" ? input : input.toString(),
      headers,
      body
    });

    return new Response(
      JSON.stringify({
        status: "accepted",
        batch_id: (body as { batch_id: string }).batch_id,
        accepted_count: Array.isArray((body as { facts?: unknown[] }).facts)
          ? (body as { facts: unknown[] }).facts.length
          : 0,
        rejected_count: 0,
        receipt_id: "rcpt_live_001"
      }),
      {
        status: 202,
        headers: { "content-type": "application/json" }
      }
    );
  }) as typeof fetch;

  const manager = await createTempManager({
    public_facts: {
      endpoint: "http://127.0.0.1:9911/v1/ingest",
      timeout_ms: 3000,
      auth_token: "test-token",
      schema_version: "1.0.0"
    }
  });

  try {
    await closeOneExportableSkillWorkflowSession(manager);

    const result = await manager.controlPlane.submitPublicFacts({
      mode: "http",
      max_batch_size: 50
    });
    assert.equal(result.created_batch_count, 1);
    assert.equal(result.submitted_batch_count, 1);
    assert.equal(received.length, 1);

    const request = received[0]!;
    assert.equal(request.url, "http://127.0.0.1:9911/v1/ingest");
    assert.equal(request.headers.get("x-schema-version"), "1.0.0");
    assert.match(String(request.headers.get("authorization")), /^Bearer test-token$/);

    const payload = request.body as {
      batch_id: string;
      schema_version: string;
      node_fingerprint: string;
      submitted_at: string;
      facts: Array<{
        public_fact_id: string;
        schema_version: string;
        node_fingerprint: string;
        subject_type: string;
        metric_name: string;
      }>;
    };
    assert.equal(payload.batch_id, result.batches[0]!.batch_id);
    assert.equal(payload.schema_version, "1.0.0");
    assert.match(payload.node_fingerprint, /^anon_[a-f0-9]{32}$/);
    assert.ok(payload.facts.length >= 1);
    assert.ok(payload.facts.every((fact) => fact.schema_version === "1.0.0"));
    assert.ok(payload.facts.every((fact) => fact.node_fingerprint === payload.node_fingerprint));
    assert.ok(payload.facts.every((fact) => fact.public_fact_id.startsWith("pfact_")));
    assert.ok(payload.facts.some((fact) => fact.subject_type === "workflow"));
    assert.ok(payload.facts.some((fact) => fact.metric_name === "invocation_count"));
    const serializedFacts = JSON.stringify(payload.facts);
    assert.equal(/sess_[a-f0-9]{16}/.test(serializedFacts), false);
    assert.equal(/run_[a-f0-9]{16}/.test(serializedFacts), false);

    const detail = await requireBatchDetail(manager, result.batches[0]!.batch_id);
    assert.equal(detail.batch.state, "acked");
    assert.equal(detail.receipts.at(-1)?.result, "accepted");
    assert.equal(detail.receipts.at(-1)?.transport_reference, "rcpt_live_001");
  } finally {
    globalThis.fetch = originalFetch;
    await manager.cleanup();
  }
});

test("retryable batches keep the same batch id and content hash across retries", async () => {
  const manager = await createTempManager();

  try {
    await closeOneExportableSession(manager);

    const first = await manager.controlPlane.submitPublicFacts({
      mode: "mock-http",
      max_batch_size: 10,
      mock_response: "retryable_error"
    });
    assert.equal(first.created_batch_count, 1);
    assert.equal(first.submitted_batch_count, 1);
    const batchId = first.batches[0]!.batch_id;
    const firstDetail = await requireBatchDetail(manager, batchId);
    assert.equal(firstDetail.batch.state, "failed_retryable");
    const firstHash = firstDetail.batch.content_hash;
    const firstFactIds = [...firstDetail.batch.fact_ids];

    const second = await manager.controlPlane.submitPublicFacts({
      mode: "mock-http",
      max_batch_size: 10,
      mock_response: "accepted"
    });
    assert.equal(second.created_batch_count, 0);
    assert.equal(second.submitted_batch_count, 1);
    assert.equal(second.batches[0]!.batch_id, batchId);

    const secondDetail = await requireBatchDetail(manager, batchId);
    assert.equal(secondDetail.batch.state, "acked");
    assert.equal(secondDetail.batch.content_hash, firstHash);
    assert.deepEqual(secondDetail.batch.fact_ids, firstFactIds);
    assert.deepEqual(
      secondDetail.receipts.map((receipt) => receipt.result),
      ["claimed", "retryable_error", "claimed", "accepted"]
    );
  } finally {
    await manager.cleanup();
  }
});

test("duplicate is treated as success and rejected batches move to dead letter with receipts", async () => {
  const duplicateManager = await createTempManager();

  try {
    await closeOneExportableSession(duplicateManager);

    const duplicate = await duplicateManager.controlPlane.submitPublicFacts({
      mode: "mock-http",
      max_batch_size: 10,
      mock_response: "duplicate"
    });
    const duplicateDetail = await requireBatchDetail(
      duplicateManager,
      duplicate.batches[0]!.batch_id
    );
    assert.equal(duplicateDetail.batch.state, "acked");
    assert.equal(duplicateDetail.receipts.at(-1)?.result, "duplicate");
  } finally {
    await duplicateManager.cleanup();
  }

  const rejectedManager = await createTempManager();

  try {
    await closeOneExportableSession(rejectedManager);

    const rejected = await rejectedManager.controlPlane.submitPublicFacts({
      mode: "mock-http",
      max_batch_size: 10,
      mock_response: "rejected"
    });
    const rejectedBatchId = rejected.batches[0]!.batch_id;
    const rejectedDetail = await requireBatchDetail(rejectedManager, rejectedBatchId);
    assert.equal(rejectedDetail.batch.state, "dead_letter");
    assert.equal(rejectedDetail.receipts.at(-1)?.result, "rejected");

    const retryAttempt = await rejectedManager.controlPlane.submitPublicFacts({
      mode: "mock-http",
      max_batch_size: 10,
      mock_response: "accepted"
    });
    assert.equal(retryAttempt.created_batch_count, 0);
    assert.equal(retryAttempt.submitted_batch_count, 0);
  } finally {
    await rejectedManager.cleanup();
  }
});

test("submit-public-facts is exposed through HTTP and command surfaces", async () => {
  const manager = await createTempManager();
  const server = new ManagerServer(manager.controlPlane, manager.config);

  try {
    await closeOneExportableSession(manager);

    const commandResult = await executeManagerCommand(
      {
        listSessions: () => manager.controlPlane.listTasks(),
        focus: () => manager.controlPlane.focus(),
        digest: async () => ({ digest: await manager.controlPlane.digest() }),
        distill: () => manager.controlPlane.distillLocalFacts(),
        submitPublicFacts: (input) => manager.controlPlane.submitPublicFacts(input),
        adopt: (input) => manager.controlPlane.adoptSession(input),
        bind: (input) => manager.controlPlane.bindSource(input),
        disableBinding: (bindingId, input) => manager.controlPlane.disableBinding(bindingId, input),
        rebindBinding: (bindingId, input) => manager.controlPlane.rebindBinding(bindingId, input),
        resume: (sessionId) => manager.controlPlane.resumeSession(sessionId),
        checkpoint: (sessionId) => manager.controlPlane.refreshCheckpoint(sessionId),
        share: (sessionId) => manager.controlPlane.shareSession(sessionId),
        close: (sessionId, input) => manager.controlPlane.closeSession(sessionId, input)
      },
      "/submit-public-facts",
      {
      mode: "dry-run",
      max_batch_size: 2
      }
    );
    assert.equal(
      (commandResult as { contract_id: string; dry_run: boolean }).contract_id,
      "submit_public_facts_v1"
    );
    assert.equal((commandResult as { contract_id: string; dry_run: boolean }).dry_run, true);

    const httpResult = await dispatchRoute(server, "POST", "/public-facts/submit", {
      mode: "local-file",
      max_batch_size: 2
    });
    assert.equal(httpResult.statusCode, 200);
    assert.equal(
      (httpResult.body as { contract_id: string; submitted_batch_count: number }).contract_id,
      "submit_public_facts_v1"
    );
    assert.ok(
      (httpResult.body as { contract_id: string; submitted_batch_count: number })
        .submitted_batch_count >= 1
    );

    const outbox = await dispatchRoute(server, "GET", "/public-facts/outbox");
    assert.equal(outbox.statusCode, 200);
    const batches = outbox.body as Array<{ batch_id: string }>;
    assert.ok(batches.length >= 1);

    const detail = await dispatchRoute(
      server,
      "GET",
      `/public-facts/outbox/${batches[0]!.batch_id}`
    );
    assert.equal(detail.statusCode, 200);
    const payload = detail.body as {
      batch: { batch_id: string; state: string };
      receipts: Array<{ result: string }>;
    };
    assert.equal(payload.batch.batch_id, batches[0]!.batch_id);
    assert.ok(payload.receipts.length >= 2);
  } finally {
    await manager.cleanup();
  }
});

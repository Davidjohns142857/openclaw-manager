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

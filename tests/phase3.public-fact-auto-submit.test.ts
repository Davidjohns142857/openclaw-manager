import assert from "node:assert/strict";
import { test } from "node:test";

import { ManagerServer } from "../src/api/server.ts";
import { createTempManager, dispatchRoute } from "./helpers.ts";

async function closeOneExportableSession(
  manager: Awaited<ReturnType<typeof createTempManager>>
): Promise<void> {
  const adopted = await manager.controlPlane.adoptSession({
    title: "Auto submit seed",
    objective: "Produce exportable local aggregate facts for auto submit.",
    scenario_signature: "scenario.auto_submit"
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

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2000,
  stepMs = 25
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms.`);
}

function buildAutoSubmitConfig() {
  return {
    endpoint: "http://142.171.114.18:56557/v1/ingest",
    timeout_ms: 3000,
    auth_token: null,
    schema_version: "1.0.0",
    auto_submit_enabled: true,
    auto_submit_interval_ms: 50,
    auto_submit_startup_delay_ms: 20,
    auto_submit_max_batch_size: 50,
    auto_submit_max_batches: 10,
    auto_submit_retry_failed_retryable: true
  } as const;
}

test("background auto submit periodically sends exportable facts over configured http transport", async () => {
  const originalFetch = globalThis.fetch;
  const received: Array<{ url: string; body: unknown }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    received.push({
      url: typeof input === "string" ? input : input.toString(),
      body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null
    });

    return new Response(
      JSON.stringify({
        status: "accepted",
        batch_id: ((received.at(-1)?.body as { batch_id: string } | null)?.batch_id ?? "batch_unknown"),
        accepted_count: 1,
        rejected_count: 0,
        receipt_id: "rcpt_auto_001"
      }),
      {
        status: 202,
        headers: { "content-type": "application/json" }
      }
    );
  }) as typeof fetch;

  const manager = await createTempManager({
    public_facts: buildAutoSubmitConfig()
  });
  const server = new ManagerServer(
    manager.controlPlane,
    manager.config,
    manager.publicFactAutoSubmitService
  );

  try {
    await closeOneExportableSession(manager);

    await waitFor(async () => {
      if (received.length < 1) {
        return false;
      }

      const batches = await manager.controlPlane.listFactOutboxBatches();
      return batches.length >= 1 && batches.every((batch) => batch.state === "acked");
    });

    assert.equal(received[0]?.url, "http://142.171.114.18:56557/v1/ingest");
    const outbox = await manager.controlPlane.listFactOutboxBatches();
    assert.ok(outbox.length >= 1);
    assert.ok(outbox.every((batch) => batch.state === "acked"));

    const health = await dispatchRoute(server, "GET", "/health");
    assert.equal(health.statusCode, 200);
    const payload = health.body as {
      public_facts: {
        endpoint: string;
        auto_submit: {
          enabled: boolean;
          total_ticks: number;
          last_success_at: string | null;
          last_result: { submitted_batch_count: number } | null;
        };
      };
    };
    assert.equal(payload.public_facts.endpoint, "http://142.171.114.18:56557/v1/ingest");
    assert.equal(payload.public_facts.auto_submit.enabled, true);
    assert.ok(payload.public_facts.auto_submit.total_ticks >= 1);
    assert.ok(payload.public_facts.auto_submit.last_success_at);
    assert.ok((payload.public_facts.auto_submit.last_result?.submitted_batch_count ?? 0) >= 1);
  } finally {
    globalThis.fetch = originalFetch;
    await manager.cleanup();
  }
});

test("background auto submit retries failed_retryable batches on the next timer tick", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    callCount += 1;

    if (callCount === 1) {
      return new Response(
        JSON.stringify({
          status: "retryable_error"
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" }
        }
      );
    }

    return new Response(
      JSON.stringify({
        status: "accepted",
        batch_id: "batch_auto_retry",
        accepted_count: 1,
        rejected_count: 0,
        receipt_id: "rcpt_auto_retry_002"
      }),
      {
        status: 202,
        headers: { "content-type": "application/json" }
      }
    );
  }) as typeof fetch;

  const manager = await createTempManager({
    public_facts: buildAutoSubmitConfig()
  });

  try {
    await closeOneExportableSession(manager);

    await waitFor(async () => {
      const batches = await manager.controlPlane.listFactOutboxBatches();
      return batches.some((batch) => batch.state === "acked");
    }, 3000);

    const batches = await manager.controlPlane.listFactOutboxBatches();
    assert.equal(batches.length, 1);
    assert.equal(batches[0]?.state, "acked");
    assert.ok(callCount >= 2);

    const detail = await manager.controlPlane.getFactOutboxBatch(batches[0]!.batch_id);
    assert.ok(detail);
    assert.deepEqual(
      detail.receipts.map((receipt) => receipt.result),
      ["claimed", "retryable_error", "claimed", "accepted"]
    );
  } finally {
    globalThis.fetch = originalFetch;
    await manager.cleanup();
  }
});

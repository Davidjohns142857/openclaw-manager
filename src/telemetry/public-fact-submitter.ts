import type {
  CapabilityFactOutboxBatch,
  MockTransportResult,
  PublicFactSubmitMode
} from "../shared/types.ts";
import type {
  SubmitPublicFactsBatchResult,
  SubmitPublicFactsInput,
  SubmitPublicFactsResult
} from "../shared/contracts.ts";
import type { LocalDistillationSnapshot } from "../shared/types.ts";
import { FactOutboxService, type FactOutboxBatchDetail } from "./fact-outbox-service.ts";

export class PublicFactSubmitter {
  outboxService: FactOutboxService;

  constructor(outboxService: FactOutboxService) {
    this.outboxService = outboxService;
  }

  async submit(
    snapshot: LocalDistillationSnapshot | null,
    input: SubmitPublicFactsInput
  ): Promise<SubmitPublicFactsResult> {
    const maxBatchSize = Math.max(1, input.max_batch_size ?? 50);
    const maxBatches = Math.max(1, input.max_batches ?? 100);
    const facts = snapshot?.facts ?? [];

    if (input.mode === "dry-run") {
      const planned = await this.outboxService.planBatches(facts, maxBatchSize);

      return {
        contract_id: "submit_public_facts_v1",
        mode: "dry-run",
        dry_run: true,
        selected_fact_count: planned.reduce((count, batch) => count + batch.fact_count, 0),
        created_batch_count: planned.length,
        submitted_batch_count: 0,
        batches: planned.slice(0, maxBatches).map((batch) => summarizeBatch(batch, null))
      };
    }

    const existing = await this.outboxService.listClaimableBatches(input.retry_failed_retryable !== false);
    const created = existing.length === 0 ? await this.outboxService.buildPendingBatches(facts, maxBatchSize) : [];
    const claimable = existing.length > 0 ? existing : created;
    const batchesToSubmit = claimable.slice(0, maxBatches);
    const results: SubmitPublicFactsBatchResult[] = [];

    for (const batch of batchesToSubmit) {
      const claimed = await this.outboxService.claimBatch(batch.batch_id, input.mode);
      const transport = await this.submitThroughTransport(claimed.batch, input.mode, input.mock_response);
      const finalized = await this.outboxService.finalizeBatch(batch.batch_id, {
        mode: input.mode,
        result: transport.result,
        responseCode: transport.response_code,
        transportReference: transport.transport_reference,
        metadata: transport.metadata
      });
      results.push(
        summarizeBatch(
          finalized.batch,
          finalized.receipts.at(-1) ?? claimed.receipts.at(-1) ?? null
        )
      );
    }

    return {
      contract_id: "submit_public_facts_v1",
      mode: input.mode,
      dry_run: false,
      selected_fact_count: claimable.reduce((count, batch) => count + batch.fact_count, 0),
      created_batch_count: created.length,
      submitted_batch_count: batchesToSubmit.length,
      batches: results
    };
  }

  private async submitThroughTransport(
    batch: CapabilityFactOutboxBatch,
    mode: Exclude<PublicFactSubmitMode, "dry-run">,
    mockResponse: MockTransportResult | undefined
  ): Promise<{
    result: MockTransportResult;
    response_code: string;
    transport_reference: string | null;
    metadata: Record<string, unknown>;
  }> {
    if (mode === "local-file") {
      const filePath = await this.outboxService.writeLocalFileReceipt(batch);
      return {
        result: "accepted",
        response_code: "local_file_written",
        transport_reference: filePath,
        metadata: {}
      };
    }

    const outcome = mockResponse ?? "accepted";
    return {
      result: outcome,
      response_code: mockResponseCode(outcome),
      transport_reference: `mock-http://${batch.batch_id}/${batch.attempt_count}`,
      metadata: {}
    };
  }
}

function summarizeBatch(
  batch: CapabilityFactOutboxBatch,
  receipt: FactOutboxBatchDetail["receipts"][number] | null
): SubmitPublicFactsBatchResult {
  return {
    batch_id: batch.batch_id,
    state: batch.state,
    content_hash: batch.content_hash,
    fact_count: batch.fact_count,
    fact_ids: batch.fact_ids,
    attempt_count: batch.attempt_count,
    last_receipt_id: batch.last_receipt_id,
    receipt_result: receipt?.result ?? null
  };
}

function mockResponseCode(result: MockTransportResult): string {
  switch (result) {
    case "accepted":
      return "mock_202_accepted";
    case "duplicate":
      return "mock_200_duplicate";
    case "retryable_error":
      return "mock_503_retryable";
    case "rejected":
      return "mock_422_rejected";
  }
}

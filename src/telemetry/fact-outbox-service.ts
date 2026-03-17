import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { createStableId } from "../shared/ids.ts";
import { isoNow } from "../shared/time.ts";
import type {
  CapabilityFact,
  CapabilityFactOutboxBatch,
  CapabilityFactOutboxReceipt,
  CapabilityFactOutboxState,
  MockTransportResult,
  PublicFactSubmitMode
} from "../shared/types.ts";
import { FilesystemStore } from "../storage/fs-store.ts";

const outboxStates: CapabilityFactOutboxState[] = [
  "pending",
  "claimed",
  "acked",
  "failed_retryable",
  "dead_letter"
];

export interface FactOutboxBatchDetail {
  batch: CapabilityFactOutboxBatch;
  receipts: CapabilityFactOutboxReceipt[];
}

export class FactOutboxService {
  store: FilesystemStore;

  constructor(store: FilesystemStore) {
    this.store = store;
  }

  async ensureLayout(): Promise<void> {
    const paths = this.store.paths();

    await Promise.all([
      mkdir(paths.publicFactsOutbox, { recursive: true }),
      mkdir(paths.publicFactsOutboxReceipts, { recursive: true }),
      mkdir(paths.publicFactsOutboxLocalFile, { recursive: true }),
      ...outboxStates.map((state) => mkdir(this.stateDir(state), { recursive: true }))
    ]);
  }

  async buildPendingBatches(
    facts: CapabilityFact[],
    maxBatchSize: number
  ): Promise<CapabilityFactOutboxBatch[]> {
    const batches = await this.planBatches(facts, maxBatchSize);

    for (const batch of batches) {
      const existing = await this.readBatch(batch.batch_id);

      if (!existing) {
        await this.writeBatch("pending", batch);
      }
    }

    return batches;
  }

  async planBatches(
    facts: CapabilityFact[],
    maxBatchSize: number
  ): Promise<CapabilityFactOutboxBatch[]> {
    const claimedFactIds = await this.claimedFactIds();
    const eligibleFacts = facts
      .filter((fact) => fact.privacy.export_policy === "public_submit_allowed")
      .filter((fact) => !claimedFactIds.has(fact.fact_id))
      .sort((left, right) => left.fact_id.localeCompare(right.fact_id));

    return splitIntoChunks(eligibleFacts, Math.max(1, maxBatchSize)).map((chunk) =>
      createBatch(chunk)
    );
  }

  async listBatches(
    states: CapabilityFactOutboxState[] = outboxStates
  ): Promise<CapabilityFactOutboxBatch[]> {
    const perStateIds = await Promise.all(states.map((state) => this.listBatchIds(state)));
    const pendingReads = perStateIds.flatMap((batchIds, index) =>
      batchIds.map((batchId) => this.readBatchInState(states[index]!, batchId))
    );
    const batches = await Promise.all(pendingReads);

    return batches
      .filter((batch): batch is CapabilityFactOutboxBatch => batch !== null)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  async readBatch(batchId: string): Promise<FactOutboxBatchDetail | null> {
    for (const state of outboxStates) {
      const batch = await this.readBatchInState(state, batchId);

      if (batch) {
        return {
          batch,
          receipts: await this.readReceipts(batchId)
        };
      }
    }

    return null;
  }

  async listClaimableBatches(
    retryFailedRetryable: boolean
  ): Promise<CapabilityFactOutboxBatch[]> {
    const states: CapabilityFactOutboxState[] = retryFailedRetryable
      ? ["failed_retryable", "pending"]
      : ["pending"];
    return this.listBatches(states);
  }

  async claimBatch(
    batchId: string,
    mode: Exclude<PublicFactSubmitMode, "dry-run">
  ): Promise<FactOutboxBatchDetail> {
    const detail = await this.requireBatch(batchId);
    const receiptId = createStableId("receipt", {
      batch_id: batchId,
      mode,
      attempt_number: detail.batch.attempt_count + 1,
      result: "claimed"
    });
    const nextAttemptCount = detail.batch.attempt_count + 1;
    const nextBatch: CapabilityFactOutboxBatch = {
      ...detail.batch,
      state: "claimed",
      transport_mode: mode,
      attempt_count: nextAttemptCount,
      last_attempt_at: isoNow(),
      last_receipt_id: receiptId,
      updated_at: isoNow()
    };

    await this.writeBatch("claimed", nextBatch);
    if (detail.batch.state !== "claimed") {
      await this.deleteBatchFile(detail.batch.state, batchId);
    }

    const receipt: CapabilityFactOutboxReceipt = {
      contract_id: "capability_fact_receipt_v1",
      receipt_id: receiptId,
      batch_id: batchId,
      mode,
      result: "claimed",
      from_state: detail.batch.state,
      to_state: "claimed",
      batch_content_hash: nextBatch.content_hash,
      attempt_number: nextAttemptCount,
      response_code: "claim_started",
      transport_reference: null,
      recorded_at: nextBatch.updated_at,
      metadata: {}
    };
    await this.appendReceipt(receipt);

    return {
      batch: nextBatch,
      receipts: [...detail.receipts, receipt]
    };
  }

  async finalizeBatch(
    batchId: string,
    input: {
      mode: Exclude<PublicFactSubmitMode, "dry-run">;
      result: MockTransportResult;
      responseCode: string;
      transportReference: string | null;
      metadata?: Record<string, unknown>;
    }
  ): Promise<FactOutboxBatchDetail> {
    const detail = await this.requireBatch(batchId);
    const nextState =
      input.result === "accepted" || input.result === "duplicate"
        ? "acked"
        : input.result === "retryable_error"
          ? "failed_retryable"
          : "dead_letter";
    const receipt: CapabilityFactOutboxReceipt = {
      contract_id: "capability_fact_receipt_v1",
      receipt_id: createStableId("receipt", {
        batch_id: batchId,
        mode: input.mode,
        attempt_number: detail.batch.attempt_count,
        result: input.result,
        response_code: input.responseCode
      }),
      batch_id: batchId,
      mode: input.mode,
      result: input.result,
      from_state: detail.batch.state,
      to_state: nextState,
      batch_content_hash: detail.batch.content_hash,
      attempt_number: detail.batch.attempt_count,
      response_code: input.responseCode,
      transport_reference: input.transportReference,
      recorded_at: isoNow(),
      metadata: input.metadata ?? {}
    };

    const nextBatch: CapabilityFactOutboxBatch = {
      ...detail.batch,
      state: nextState,
      last_receipt_id: receipt.receipt_id,
      updated_at: receipt.recorded_at
    };

    await this.writeBatch(nextState, nextBatch);
    if (detail.batch.state !== nextState) {
      await this.deleteBatchFile(detail.batch.state, batchId);
    }

    await this.appendReceipt(receipt);

    return {
      batch: nextBatch,
      receipts: [...detail.receipts, receipt]
    };
  }

  async writeLocalFileReceipt(batch: CapabilityFactOutboxBatch): Promise<string> {
    await this.ensureLayout();
    const attemptPath = path.join(
      this.store.paths().publicFactsOutboxLocalFile,
      `${batch.batch_id}.attempt-${batch.attempt_count}.json`
    );
    await this.store.writeJson(attemptPath, {
      batch_id: batch.batch_id,
      content_hash: batch.content_hash,
      fact_count: batch.fact_count,
      facts: batch.facts
    });
    return attemptPath;
  }

  async claimedFactIds(): Promise<Set<string>> {
    const batches = await this.listBatches();
    return new Set(batches.flatMap((batch) => batch.fact_ids));
  }

  private async requireBatch(batchId: string): Promise<FactOutboxBatchDetail> {
    const detail = await this.readBatch(batchId);

    if (!detail) {
      throw new Error(`Outbox batch not found: ${batchId}`);
    }

    return detail;
  }

  private stateDir(state: CapabilityFactOutboxState): string {
    return path.join(this.store.paths().publicFactsOutbox, state);
  }

  private batchPath(state: CapabilityFactOutboxState, batchId: string): string {
    return path.join(this.stateDir(state), `${batchId}.json`);
  }

  private receiptPath(batchId: string): string {
    return path.join(this.store.paths().publicFactsOutboxReceipts, `${batchId}.jsonl`);
  }

  private async listBatchIds(state: CapabilityFactOutboxState): Promise<string[]> {
    try {
      const entries = await readdir(this.stateDir(state), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.replace(/\.json$/, ""))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private async readBatchInState(
    state: CapabilityFactOutboxState,
    batchId: string
  ): Promise<CapabilityFactOutboxBatch | null> {
    const batch = await this.store.readJson<CapabilityFactOutboxBatch>(this.batchPath(state, batchId));

    if (!batch) {
      return null;
    }

    await this.store.schemaRegistry.validateOrThrow("fact-outbox-batch", batch);
    return batch;
  }

  private async writeBatch(
    state: CapabilityFactOutboxState,
    batch: CapabilityFactOutboxBatch
  ): Promise<void> {
    await this.store.schemaRegistry.validateOrThrow("fact-outbox-batch", batch);
    await mkdir(this.stateDir(state), { recursive: true });
    await this.store.writeJson(this.batchPath(state, batch.batch_id), batch);
  }

  private async deleteBatchFile(state: CapabilityFactOutboxState, batchId: string): Promise<void> {
    try {
      await unlink(this.batchPath(state, batchId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }

      throw error;
    }
  }

  private async appendReceipt(receipt: CapabilityFactOutboxReceipt): Promise<void> {
    await this.store.schemaRegistry.validateOrThrow("fact-outbox-receipt", receipt);
    await mkdir(this.store.paths().publicFactsOutboxReceipts, { recursive: true });
    await this.store.appendJsonl(this.receiptPath(receipt.batch_id), receipt);
  }

  private async readReceipts(batchId: string): Promise<CapabilityFactOutboxReceipt[]> {
    const receipts = await this.store.readJsonl<CapabilityFactOutboxReceipt>(this.receiptPath(batchId));

    for (const receipt of receipts) {
      await this.store.schemaRegistry.validateOrThrow("fact-outbox-receipt", receipt);
    }

    return receipts.sort(
      (left, right) =>
        left.attempt_number - right.attempt_number ||
        left.recorded_at.localeCompare(right.recorded_at)
    );
  }
}

function createBatch(facts: CapabilityFact[]): CapabilityFactOutboxBatch {
  const contentHash = createHash("sha256")
    .update(JSON.stringify(facts))
    .digest("hex")
    .slice(0, 16);
  const batchId = createStableId("batch", {
    fact_ids: facts.map((fact) => fact.fact_id).sort(),
    content_hash: contentHash
  });
  const createdAt = maxIso(facts.map((fact) => fact.computed_at)) ?? isoNow();

  return {
    contract_id: "capability_fact_batch_v1",
    batch_id: batchId,
    state: "pending",
    transport_mode: null,
    fact_ids: facts.map((fact) => fact.fact_id),
    fact_count: facts.length,
    facts,
    content_hash: contentHash,
    attempt_count: 0,
    last_attempt_at: null,
    last_receipt_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    metadata: {}
  };
}

function splitIntoChunks<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function maxIso(values: string[]): string | null {
  const filtered = values.filter(Boolean).sort();
  return filtered.at(-1) ?? null;
}

import { createHash, randomUUID } from "node:crypto";

import { createStableId } from "../shared/ids.ts";
import type {
  CapabilityFact,
  CapabilityFactOutboxBatch,
  LocalDistillationSnapshot,
  ManagerConfig,
  MockTransportResult,
  PublicCapabilityFact,
  PublicCapabilityFactBatchRequest,
  PublicCapabilityFactBatchResponse,
  PublicFactSubmitMode
} from "../shared/types.ts";
import type {
  SubmitPublicFactsBatchResult,
  SubmitPublicFactsInput,
  SubmitPublicFactsResult
} from "../shared/contracts.ts";
import { FilesystemStore } from "../storage/fs-store.ts";
import { FactOutboxService, type FactOutboxBatchDetail } from "./fact-outbox-service.ts";

export class PublicFactSubmitter {
  config: ManagerConfig;
  store: FilesystemStore;
  outboxService: FactOutboxService;

  constructor(config: ManagerConfig, store: FilesystemStore, outboxService: FactOutboxService) {
    this.config = config;
    this.store = store;
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
    const created =
      existing.length === 0 ? await this.outboxService.buildPendingBatches(facts, maxBatchSize) : [];
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

    if (mode === "mock-http") {
      const outcome = mockResponse ?? "accepted";
      return {
        result: outcome,
        response_code: mockResponseCode(outcome),
        transport_reference: `mock-http://${batch.batch_id}/${batch.attempt_count}`,
        metadata: {}
      };
    }

    return this.submitToConfiguredHttp(batch);
  }

  private async submitToConfiguredHttp(batch: CapabilityFactOutboxBatch): Promise<{
    result: MockTransportResult;
    response_code: string;
    transport_reference: string | null;
    metadata: Record<string, unknown>;
  }> {
    const endpoint = this.config.public_facts.endpoint;
    const timeoutMs = Math.max(1000, this.config.public_facts.timeout_ms);
    const nodeFingerprint = await this.getNodeFingerprint();
    const submittedAt = new Date().toISOString();
    const payload = buildPublicBatchRequest(
      batch,
      nodeFingerprint,
      this.config.public_facts.schema_version,
      submittedAt
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-schema-version": payload.schema_version,
          "x-node-fingerprint": payload.node_fingerprint,
          ...(this.config.public_facts.auth_token
            ? { authorization: `Bearer ${this.config.public_facts.auth_token}` }
            : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const responseBody = await readJsonResponse(response);
      return mapHttpResponse(endpoint, response.status, responseBody);
    } catch (error) {
      return {
        result: "retryable_error",
        response_code: error instanceof Error && error.name === "AbortError"
          ? "http_timeout"
          : "http_transport_error",
        transport_reference: endpoint,
        metadata: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getNodeFingerprint(): Promise<string> {
    const secretPath = this.store.paths().publicFactsNodeSecret;
    const existing = await this.store.readText(secretPath);
    const secret = existing?.trim() || `secret_${randomUUID().replace(/-/g, "")}`;

    if (!existing?.trim()) {
      await this.store.writeText(secretPath, `${secret}\n`);
    }

    return `anon_${createHash("sha256").update(`${secret}:openclaw-public-facts`).digest("hex").slice(0, 32)}`;
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

function buildPublicBatchRequest(
  batch: CapabilityFactOutboxBatch,
  nodeFingerprint: string,
  schemaVersion: string,
  submittedAt: string
): PublicCapabilityFactBatchRequest {
  return {
    schema_version: schemaVersion,
    node_fingerprint: nodeFingerprint,
    batch_id: batch.batch_id,
    submitted_at: submittedAt,
    facts: batch.facts.map((fact) =>
      buildPublicFact(fact, nodeFingerprint, schemaVersion, submittedAt)
    )
  };
}

function buildPublicFact(
  fact: CapabilityFact,
  nodeFingerprint: string,
  schemaVersion: string,
  submittedAt: string
): PublicCapabilityFact {
  return {
    public_fact_id: createStableId("pfact", {
      fact_id: fact.fact_id,
      node_fingerprint: nodeFingerprint,
      schema_version: schemaVersion
    }),
    schema_version: schemaVersion,
    node_fingerprint: nodeFingerprint,
    subject_type: fact.subject.subject_type,
    subject_ref: fact.subject.subject_ref,
    subject_version: fact.subject.subject_version,
    scenario_signature: fact.scenario_signature,
    scenario_tags: fact.scenario_signature === "all_scenarios"
      ? []
      : fact.scenario_signature.split(".").filter(Boolean),
    metric_name: fact.metric_name,
    metric_value: fact.metric_value,
    sample_size: fact.sample_size,
    confidence: fact.confidence,
    context: buildPublicFactContext(fact),
    computed_at: fact.computed_at,
    submitted_at: submittedAt
  };
}

function buildPublicFactContext(fact: CapabilityFact): Record<string, unknown> | undefined {
  const context: Record<string, unknown> = {};

  if (typeof fact.metric_value === "number" && fact.metric_name === "avg_duration_ms") {
    context.avg_duration_ms = fact.metric_value;
  }

  if (Array.isArray(fact.metadata.skill_names)) {
    context.co_skills = fact.metadata.skill_names.filter(
      (entry): entry is string => typeof entry === "string"
    );
  }

  if (typeof fact.metadata.skill_count === "number") {
    context.co_skill_count = fact.metadata.skill_count;
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapHttpResponse(
  endpoint: string,
  statusCode: number,
  payload: unknown
): {
  result: MockTransportResult;
  response_code: string;
  transport_reference: string | null;
  metadata: Record<string, unknown>;
} {
  const body = payload as PublicCapabilityFactBatchResponse | null;
  const status = typeof body?.status === "string" ? body.status : null;
  const receiptId = typeof body?.receipt_id === "string" ? body.receipt_id : null;

  if (statusCode === 409 || status === "duplicate") {
    return {
      result: "duplicate",
      response_code: status ?? `http_${statusCode}_duplicate`,
      transport_reference: receiptId ?? endpoint,
      metadata: sanitizeMetadata(body)
    };
  }

  if (statusCode >= 200 && statusCode < 300 && status !== "partial" && status !== "rejected") {
    return {
      result: "accepted",
      response_code: status ?? `http_${statusCode}_accepted`,
      transport_reference: receiptId ?? endpoint,
      metadata: sanitizeMetadata(body)
    };
  }

  if (statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500) {
    return {
      result: "retryable_error",
      response_code: status ?? `http_${statusCode}_retryable`,
      transport_reference: endpoint,
      metadata: sanitizeMetadata(body)
    };
  }

  return {
    result: "rejected",
    response_code: status ?? `http_${statusCode}_rejected`,
    transport_reference: receiptId ?? endpoint,
    metadata: sanitizeMetadata(body)
  };
}

function sanitizeMetadata(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return {};
  }

  const candidate = payload as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};

  for (const key of ["status", "accepted_count", "rejected_count", "receipt_id", "rejected_facts"]) {
    if (candidate[key] !== undefined) {
      metadata[key] = candidate[key];
    }
  }

  return metadata;
}

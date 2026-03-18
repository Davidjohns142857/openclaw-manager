import type {
  ManagerConfig,
  PublicFactsAutoSubmitStatus
} from "../shared/types.ts";
import type {
  SubmitPublicFactsInput,
  SubmitPublicFactsResult
} from "../shared/contracts.ts";
import { isoNow } from "../shared/time.ts";

export interface PublicFactAutoSubmitExecutor {
  distillLocalFacts(): Promise<unknown>;
  submitPublicFacts(input: SubmitPublicFactsInput): Promise<SubmitPublicFactsResult>;
}

export class PublicFactAutoSubmitService {
  private readonly config: ManagerConfig;
  private readonly executor: PublicFactAutoSubmitExecutor;
  private timer: NodeJS.Timeout | null;
  private stopped: boolean;
  private readonly status: PublicFactsAutoSubmitStatus;

  constructor(config: ManagerConfig, executor: PublicFactAutoSubmitExecutor) {
    this.config = config;
    this.executor = executor;
    this.timer = null;
    this.stopped = false;
    this.status = {
      enabled: config.public_facts.auto_submit_enabled,
      mode: "http",
      interval_ms: config.public_facts.auto_submit_interval_ms,
      startup_delay_ms: config.public_facts.auto_submit_startup_delay_ms,
      in_flight: false,
      total_ticks: 0,
      last_tick_at: null,
      last_success_at: null,
      last_result: null,
      last_error: null
    };
  }

  start(): void {
    if (!this.status.enabled || this.timer !== null || this.stopped) {
      return;
    }

    this.schedule(this.config.public_facts.auto_submit_startup_delay_ms);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getStatus(): PublicFactsAutoSubmitStatus {
    return structuredClone(this.status);
  }

  async runNow(reason: "manual" | "timer" | "startup" = "manual"): Promise<SubmitPublicFactsResult | null> {
    if (!this.status.enabled || this.status.in_flight) {
      return null;
    }

    this.status.in_flight = true;
    this.status.total_ticks += 1;
    this.status.last_tick_at = isoNow();
    this.status.last_error = null;

    try {
      await this.executor.distillLocalFacts();
      const result = await this.executor.submitPublicFacts({
        mode: "http",
        max_batch_size: this.config.public_facts.auto_submit_max_batch_size,
        max_batches: this.config.public_facts.auto_submit_max_batches,
        retry_failed_retryable: this.config.public_facts.auto_submit_retry_failed_retryable
      });
      this.status.last_success_at = isoNow();
      this.status.last_result = {
        selected_fact_count: result.selected_fact_count,
        created_batch_count: result.created_batch_count,
        submitted_batch_count: result.submitted_batch_count,
        receipt_results: result.batches.map((batch) => batch.receipt_result)
      };
      this.status.last_error = null;
      return result;
    } catch (error) {
      this.status.last_error = `${reason}: ${error instanceof Error ? error.message : String(error)}`;
      return null;
    } finally {
      this.status.in_flight = false;
      if (!this.stopped && reason !== "manual") {
        this.schedule(this.config.public_facts.auto_submit_interval_ms);
      }
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runNow(this.status.total_ticks === 0 ? "startup" : "timer");
    }, Math.max(50, delayMs));
    this.timer.unref?.();
  }
}

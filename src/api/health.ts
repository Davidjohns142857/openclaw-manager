import { isoNow } from "../shared/time.ts";
import type { ManagerConfig, PublicFactsAutoSubmitStatus } from "../shared/types.ts";

export function buildHealthPayload(
  config: ManagerConfig,
  sessionCount: number,
  publicFactAutoSubmit?: PublicFactsAutoSubmitStatus
): Record<string, unknown> {
  return {
    status: "ok",
    now: isoNow(),
    state_root: config.stateRoot,
    port: config.port,
    session_count: sessionCount,
    public_facts: {
      endpoint: config.public_facts.endpoint,
      schema_version: config.public_facts.schema_version,
      auto_submit: publicFactAutoSubmit ?? {
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
      }
    }
  };
}

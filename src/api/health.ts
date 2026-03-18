import { isoNow } from "../shared/time.ts";
import type { ManagerConfig, PublicFactsAutoSubmitStatus } from "../shared/types.ts";
import {
  buildLocalSessionConsoleUrl,
  buildPublishedSessionConsoleUrl
} from "../shared/ui.ts";

export function buildHealthPayload(
  config: ManagerConfig,
  sessionCount: number,
  publicFactAutoSubmit?: PublicFactsAutoSubmitStatus,
  effectivePort: number = config.port
): Record<string, unknown> {
  const publishedSessionConsoleUrl = buildPublishedSessionConsoleUrl(config.ui.public_base_url);

  return {
    status: "ok",
    now: isoNow(),
    state_root: config.stateRoot,
    port: effectivePort,
    session_count: sessionCount,
    ui: {
      access_mode: publishedSessionConsoleUrl ? "external" : "local_only",
      session_console_url: publishedSessionConsoleUrl,
      local_session_console_url: buildLocalSessionConsoleUrl(effectivePort)
    },
    host_integration: {
      mode: config.host_integration.mode,
      reason: config.host_integration.reason
    },
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

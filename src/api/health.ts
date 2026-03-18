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
  effectivePort: number = config.port,
  options: {
    ui_read_only?: boolean;
  } = {}
): Record<string, unknown> {
  const publishedSessionConsoleUrl = buildPublishedSessionConsoleUrl(config.ui.public_base_url);

  return {
    status: "ok",
    now: isoNow(),
    state_root: config.stateRoot,
    port: effectivePort,
    session_count: sessionCount,
    ui: {
      access_mode:
        config.ui.publish_port !== null
          ? "published_proxy"
          : publishedSessionConsoleUrl
            ? "external"
            : "local_only",
      read_only: options.ui_read_only ?? false,
      session_console_url: publishedSessionConsoleUrl,
      local_session_console_url: buildLocalSessionConsoleUrl(effectivePort),
      publish_proxy: {
        enabled: config.ui.publish_port !== null,
        bind_host: config.ui.publish_bind_host,
        port: config.ui.publish_port
      }
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

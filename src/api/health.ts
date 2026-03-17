import { isoNow } from "../shared/time.ts";
import type { ManagerConfig } from "../shared/types.ts";

export function buildHealthPayload(config: ManagerConfig, sessionCount: number): Record<string, unknown> {
  return {
    status: "ok",
    now: isoNow(),
    state_root: config.stateRoot,
    port: config.port,
    session_count: sessionCount
  };
}


import type { Run, RunStatus, Session } from "./types.ts";

export interface SessionActivity {
  run: {
    state: "running" | "idle";
    phase: RunStatus | "idle";
  };
  queue: {
    state: "pending" | "idle";
    count: number;
  };
  summary: {
    state: "fresh" | "stale";
  };
}

export function deriveSessionActivity(session: Session, run: Run | null): SessionActivity {
  const queueCount = session.state.pending_external_inputs.length;
  const isActiveRun = Boolean(run && session.active_run_id === run.run_id);

  return {
    run: {
      state: isActiveRun ? "running" : "idle",
      phase: run?.status ?? "idle"
    },
    queue: {
      state: queueCount > 0 ? "pending" : "idle",
      count: queueCount
    },
    summary: {
      state: session.metadata.summary_needs_refresh === true ? "stale" : "fresh"
    }
  };
}

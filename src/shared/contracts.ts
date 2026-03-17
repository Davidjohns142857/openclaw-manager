import type { Checkpoint, NormalizedInboundMessage, Priority, Run, Session, SourceChannel } from "./types.ts";

export interface AdoptSessionInput {
  title: string;
  objective: string;
  owner_ref?: string;
  priority?: Priority;
  tags?: string[];
  scenario_signature?: string;
  source_channel?: SourceChannel;
  next_machine_actions?: string[];
  metadata?: Record<string, unknown>;
}

export interface ResumeSessionResult {
  session: Session;
  run: Run | null;
  checkpoint: Checkpoint | null;
  summary: string | null;
}

export interface CloseSessionInput {
  outcome_summary: string;
  resolution?: "completed" | "abandoned";
  metadata?: Record<string, unknown>;
}

export interface ShareSnapshotResult {
  session_id: string;
  snapshot_id: string;
  snapshot_path: string;
  manifest_path: string;
  index_path: string;
}

export interface InboundHandlingResult {
  message: NormalizedInboundMessage;
  session: Session;
  run: Run | null;
  run_started: boolean;
  duplicate: boolean;
  queued: boolean;
}

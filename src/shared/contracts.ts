import type {
  Checkpoint,
  ConnectorBinding,
  NormalizedInboundMessage,
  Priority,
  Run,
  Session,
  SourceChannel
} from "./types.ts";

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

export interface BindSourceInput {
  session_id: string;
  source_type: string;
  source_thread_key: string;
  metadata?: Record<string, unknown>;
}

export interface BindSourceResult {
  binding: ConnectorBinding;
  created: boolean;
  session: Session;
  run: Run | null;
  checkpoint: Checkpoint | null;
  summary: string | null;
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

export interface RequestHumanDecisionInput {
  decision_id?: string;
  summary: string;
  urgency?: Priority;
  requested_by_ref?: string;
  requested_at?: string;
  next_human_actions?: string[];
  metadata?: Record<string, unknown>;
}

export interface ResolveHumanDecisionInput {
  resolution_summary: string;
  resolved_by_ref?: string;
  resolved_at?: string;
  next_machine_actions?: string[];
  next_human_actions?: string[];
  metadata?: Record<string, unknown>;
}

export interface DetectBlockerInput {
  blocker_id?: string;
  type: string;
  summary: string;
  severity?: Priority;
  detected_by_ref?: string;
  detected_at?: string;
  next_human_actions?: string[];
  metadata?: Record<string, unknown>;
}

export interface ClearBlockerInput {
  resolution_summary: string;
  cleared_by_ref?: string;
  cleared_at?: string;
  next_machine_actions?: string[];
  next_human_actions?: string[];
  metadata?: Record<string, unknown>;
}

export type ReservedContractStatus = "accepted" | "not_enabled" | "reserved" | "rejected";
export type ReservedContractFeatureFlag = "decision_lifecycle_v1" | "blocker_lifecycle_v1";

export interface ReservedContractMutationResult {
  contract_id: string;
  feature_flag: ReservedContractFeatureFlag;
  status: ReservedContractStatus;
  error_code: string | null;
  mutation_applied: boolean;
  session: Session;
  run: Run | null;
  checkpoint: Checkpoint | null;
  summary: string | null;
}

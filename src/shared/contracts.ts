import type { SessionActivity } from "./activity.ts";
import type { SessionStatusReason } from "./session-status.ts";
import type {
  Blocker,
  Checkpoint,
  ConnectorBinding,
  ConnectorBindingStatus,
  EventType,
  LocalDistillationSnapshot,
  NormalizedInboundMessage,
  PendingHumanDecision,
  Priority,
  Run,
  RunOutcome,
  RunPlanner,
  RunResultType,
  RunStatus,
  RunTrigger,
  SettledRunStatus,
  Session,
  SessionStatus,
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

export interface BindingListFilters {
  binding_id?: string;
  session_id?: string;
  source_type?: string;
  source_thread_key?: string;
  status?: ConnectorBindingStatus;
}

export interface BindSourceResult {
  binding: ConnectorBinding;
  created: boolean;
  session: Session;
  run: Run | null;
  checkpoint: Checkpoint | null;
  summary: string | null;
}

export interface DisableBindingInput {
  reason?: string;
  disabled_by_ref?: string;
  disabled_at?: string;
  metadata?: Record<string, unknown>;
}

export interface DisableBindingResult {
  binding: ConnectorBinding;
  changed: boolean;
  session: Session;
  run: Run | null;
  checkpoint: Checkpoint | null;
  summary: string | null;
}

export interface RebindSourceInput {
  session_id: string;
  rebound_by_ref?: string;
  rebound_at?: string;
  metadata?: Record<string, unknown>;
}

export interface RebindSourceResult {
  binding: ConnectorBinding;
  previous_session_id: string;
  changed: boolean;
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

interface BaseSettleRunInput {
  status: SettledRunStatus;
  summary?: string;
  reason_code?: string;
  next_machine_actions?: string[];
  next_human_actions?: string[];
  blockers?: Blocker[];
  pending_human_decisions?: PendingHumanDecision[];
  checkpoint_notes?: string[];
}

export type SettleRunInput =
  | (BaseSettleRunInput & {
      status: "waiting_human";
      result_type?: "waiting_human";
    })
  | (BaseSettleRunInput & {
      status: "blocked";
      result_type?: "blocked";
    })
  | (BaseSettleRunInput & {
      status: "completed";
      result_type?: Extract<RunResultType, "completed" | "partial_progress" | "no_op">;
    })
  | (BaseSettleRunInput & {
      status: "failed";
      result_type?: "failed";
    })
  | (BaseSettleRunInput & {
      status: "cancelled";
      result_type?: null;
    })
  | (BaseSettleRunInput & {
      status: "superseded";
      result_type?: null;
    });

export interface RunSettlementResult {
  session: Session;
  run: Run;
  checkpoint: Checkpoint | null;
  summary: string | null;
  recovery_head_advanced: boolean;
}

export interface SessionTimelineSummary {
  session_id: string;
  title: string;
  objective: string;
  status: SessionStatus;
  status_reason: SessionStatusReason;
  active_run_id: string | null;
  latest_checkpoint_ref: string | null;
  latest_summary_ref: string | null;
  activity: SessionActivity;
}

export interface RunStatusFlowEntry {
  event_id: string;
  event_type: EventType;
  timestamp: string;
  status: RunStatus | null;
  summary: string | null;
  reason_code: string | null;
}

export interface RunRecoveryView {
  recovery_checkpoint_ref: string | null;
  end_checkpoint_ref: string | null;
  summary_ref: string | null;
  committed_checkpoint_available: boolean;
  terminal_head_advanced: boolean;
  checkpoint_created_at: string | null;
  checkpoint_session_status: SessionStatus | null;
  checkpoint_phase: string | null;
  blocker_count: number;
  pending_human_decision_count: number;
  pending_external_input_count: number;
  next_machine_actions: string[];
  next_human_actions: string[];
  artifact_refs: string[];
}

export interface RunEvidenceView {
  events_ref: string | null;
  event_count: number;
  skill_traces_ref: string | null;
  skill_trace_count: number;
  spool_ref: string | null;
  spool_line_count: number;
  artifact_refs: string[];
  invoked_skills: string[];
  invoked_tools: string[];
}

export interface RunTimelineView {
  run_id: string;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  trigger: RunTrigger;
  planner: RunPlanner;
  outcome: RunOutcome;
  status_flow: RunStatusFlowEntry[];
  recovery: RunRecoveryView;
  evidence: RunEvidenceView;
}

export interface SessionTimelineView {
  contract_id: "session_run_timeline_v1";
  generated_at: string;
  session: SessionTimelineSummary;
  run_count: number;
  runs: RunTimelineView[];
}

export interface DistillLocalFactsResult {
  snapshot: LocalDistillationSnapshot;
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

export type OwnerType = "human" | "agent" | "system";
export type SessionStatus =
  | "draft"
  | "active"
  | "waiting_human"
  | "blocked"
  | "completed"
  | "abandoned"
  | "archived";
export type LifecycleStage =
  | "intake"
  | "planning"
  | "execution"
  | "review"
  | "closure"
  | "archival";
export type Priority = "low" | "medium" | "high" | "critical";
export type GoalStatus =
  | "not_started"
  | "in_progress"
  | "waiting_input"
  | "partially_complete"
  | "complete"
  | "abandoned";
export type RunStatus =
  | "accepted"
  | "queued"
  | "running"
  | "waiting_human"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "superseded";
export type RunTriggerType =
  | "manual"
  | "message"
  | "external_message"
  | "scheduled"
  | "resume"
  | "retry"
  | "system_maintenance";
export type RunResultType =
  | "no_op"
  | "partial_progress"
  | "awaiting_human"
  | "blocked"
  | "completed"
  | "failed";
export type EventType =
  | "message_received"
  | "message_normalized"
  | "run_accepted"
  | "run_started"
  | "run_status_changed"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "skill_invoked"
  | "skill_completed"
  | "skill_failed"
  | "tool_called"
  | "artifact_created"
  | "artifact_updated"
  | "checkpoint_written"
  | "summary_refreshed"
  | "blocker_detected"
  | "blocker_cleared"
  | "human_decision_requested"
  | "human_decision_resolved"
  | "external_trigger_bound"
  | "external_trigger_unbound"
  | "external_trigger_rebound"
  | "session_shared"
  | "session_closed"
  | "session_archived"
  | "capability_fact_emitted";
export type EventActorType = "human" | "agent" | "system" | "external";
export type AttentionCategory =
  | "waiting_human"
  | "blocked"
  | "stale"
  | "desynced"
  | "summary_drift";
export type AttentionUrgency = Priority;
export type ContributionType = "primary" | "supporting" | "observed" | "regressive";
export type MessageType =
  | "user_message"
  | "system_update"
  | "artifact_notice"
  | "decision_response";

export interface OwnerRef {
  type: OwnerType;
  ref: string;
}

export interface SourceChannel {
  source_type: string;
  source_ref: string;
  bound_at: string;
  metadata?: Record<string, unknown>;
}

export type ConnectorBindingStatus = "active" | "disabled";

export interface ConnectorBinding {
  binding_id: string;
  source_type: string;
  source_thread_key: string;
  session_id: string;
  status: ConnectorBindingStatus;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface Blocker {
  blocker_id: string;
  type: string;
  summary: string;
  detected_at: string;
  severity: Priority;
}

export interface PendingHumanDecision {
  decision_id: string;
  summary: string;
  requested_at: string;
  urgency: Priority;
}

export interface SessionState {
  phase: string;
  goal_status: GoalStatus;
  blockers: Blocker[];
  pending_human_decisions: PendingHumanDecision[];
  pending_external_inputs: string[];
  next_machine_actions: string[];
  next_human_actions: string[];
}

export interface SessionMetrics {
  run_count: number;
  failed_run_count: number;
  human_intervention_count: number;
  artifact_count: number;
  last_activity_at: string;
}

export interface SessionSharing {
  is_shareable: boolean;
  latest_snapshot_id: string | null;
}

export interface Session {
  session_id: string;
  title: string;
  objective: string;
  owner: OwnerRef;
  status: SessionStatus;
  lifecycle_stage: LifecycleStage;
  priority: Priority;
  scenario_signature: string | null;
  tags: string[];
  source_channels: SourceChannel[];
  active_run_id: string | null;
  latest_summary_ref: string | null;
  latest_checkpoint_ref: string | null;
  state: SessionState;
  metrics: SessionMetrics;
  sharing: SessionSharing;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  metadata: Record<string, unknown>;
}

export interface RunTrigger {
  trigger_type: RunTriggerType;
  trigger_ref: string | null;
  request_id: string | null;
  external_trigger_id: string | null;
}

export interface RunPlanner {
  planner_name: string;
  planner_version: string;
}

export interface RunExecution {
  invoked_skills: string[];
  invoked_tools: string[];
  start_checkpoint_ref: string | null;
  recovery_checkpoint_ref: string | null;
  end_checkpoint_ref: string | null;
  events_ref: string | null;
  skill_traces_ref: string | null;
  artifact_refs: string[];
  spool_ref: string | null;
  summary_ref: string | null;
}

export interface RunOutcome {
  result_type: RunResultType | null;
  summary: string | null;
  reason_code: string | null;
  human_takeover: boolean;
  closure_contribution: number | null;
}

export interface RunMetrics {
  skill_invocation_count: number;
  tool_call_count: number;
  error_count: number;
  human_intervention_count: number;
  duration_ms: number | null;
}

export interface Run {
  run_id: string;
  session_id: string;
  status: RunStatus;
  trigger: RunTrigger;
  planner: RunPlanner;
  execution: RunExecution;
  outcome: RunOutcome;
  metrics: RunMetrics;
  started_at: string;
  ended_at: string | null;
  metadata: Record<string, unknown>;
}

export interface EventActor {
  actor_type: EventActorType;
  actor_ref: string;
}

export interface EventCausality {
  causal_parent: string | null;
  correlation_id: string | null;
  request_id: string | null;
  external_trigger_id: string | null;
}

export interface Event {
  event_id: string;
  session_id: string;
  run_id: string | null;
  event_type: EventType;
  actor: EventActor;
  causality: EventCausality;
  payload: Record<string, unknown> | null;
  payload_ref: string | null;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface SkillTrace {
  trace_id: string;
  session_id: string;
  run_id: string;
  skill_name: string;
  skill_version: string | null;
  invocation_reason: string | null;
  input_schema_hash: string | null;
  output_schema_hash: string | null;
  duration_ms: number;
  success: boolean;
  contribution_type: ContributionType;
  downstream_effect: string | null;
  requires_human_fix: boolean;
  closure_contribution_score: number;
  scenario_tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AttentionUnit {
  attention_id: string;
  session_id: string;
  category: AttentionCategory;
  urgency: AttentionUrgency;
  expected_human_action: string;
  reasoning_summary: string;
  stale_after: string | null;
  confidence: number;
  recommended_next_step: string;
  attention_priority: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CapabilityFact {
  fact_id: string;
  subject_type: "session" | "run" | "skill" | "workflow" | "connector";
  subject_ref: string;
  scenario_signature: string;
  metric_name: string;
  metric_value: number | string | boolean;
  sample_size: number;
  confidence: number;
  evidence_refs: string[];
  metadata: Record<string, unknown>;
  computed_at: string;
}

export interface AttachmentRef {
  name?: string;
  mime_type?: string;
  ref?: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedInboundMessage {
  request_id: string;
  external_trigger_id: string | null;
  source_type: string;
  source_thread_key: string;
  target_session_id: string;
  message_type: MessageType;
  content: string;
  attachments: AttachmentRef[];
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface Checkpoint {
  session_id: string;
  run_id: string;
  session_status: SessionStatus;
  phase: string;
  blockers: Blocker[];
  pending_human_decisions: PendingHumanDecision[];
  pending_external_inputs: string[];
  artifact_refs: string[];
  next_machine_actions: string[];
  next_human_actions: string[];
  active_assumptions: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface RecoveryHead {
  session_id: string;
  run_id: string;
  transaction_id: string;
  committed_at: string;
}

export interface ManagerFeatureFlags {
  decision_lifecycle_v1: boolean;
  blocker_lifecycle_v1: boolean;
}

export interface SessionIndexEntry {
  session_id: string;
  title: string;
  status: SessionStatus;
  lifecycle_stage: LifecycleStage;
  priority: Priority;
  active_run_id: string | null;
  last_activity_at: string;
  tags: string[];
}

export interface ManagerConfig {
  repoRoot: string;
  stateRoot: string;
  templatesDir: string;
  schemasDir: string;
  port: number;
  features: ManagerFeatureFlags;
}

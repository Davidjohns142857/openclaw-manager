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
export type SettledRunStatus =
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
  | "waiting_human"
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
  | "run_superseded"
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
export type CapabilityFactSubjectType =
  | "node"
  | "scenario"
  | "session"
  | "run"
  | "skill"
  | "workflow"
  | "connector";
export type CapabilityFactKind = "raw_observation" | "aggregate_metric";
export type CapabilityFactExportPolicy = "local_only" | "public_submit_allowed";
export type CapabilityFactPrivacyTier = "node_private" | "aggregated_export_safe";
export type CapabilityFactWindowType = "point_in_time" | "closed_session_history";
export type CapabilityFactOutboxState =
  | "pending"
  | "claimed"
  | "acked"
  | "failed_retryable"
  | "dead_letter";
export type PublicFactSubmitMode = "dry-run" | "local-file" | "mock-http" | "http";
export type HostIntegrationMode = "managed_hook" | "manual_adopt";
export type MockTransportResult =
  | "accepted"
  | "duplicate"
  | "retryable_error"
  | "rejected";

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

export interface CapabilityFactSubject {
  subject_type: CapabilityFactSubjectType;
  subject_ref: string;
  subject_version: string | null;
}

export interface CapabilityFactAggregationWindow {
  window_type: CapabilityFactWindowType;
  start_at: string | null;
  end_at: string;
}

export interface CapabilityFactPrivacy {
  privacy_tier: CapabilityFactPrivacyTier;
  export_policy: CapabilityFactExportPolicy;
  contains_identifiers: boolean;
  contains_content: boolean;
  declaration: string;
}

export interface CapabilityFact {
  fact_id: string;
  fact_kind: CapabilityFactKind;
  subject: CapabilityFactSubject;
  scenario_signature: string;
  metric_name: string;
  metric_value: number | string | boolean;
  sample_size: number;
  confidence: number;
  aggregation_window: CapabilityFactAggregationWindow;
  privacy: CapabilityFactPrivacy;
  evidence_refs: string[];
  metadata: Record<string, unknown>;
  computed_at: string;
}

export type LocalDistillationScopeType = "node" | "scenario" | "skill" | "workflow";
export type LocalDistilledMetricName =
  | "closure_rate"
  | "recovery_success_rate"
  | "human_intervention_rate"
  | "blocked_recurrence_rate"
  | "run_trigger_rate"
  | "success_rate"
  | "failure_rate"
  | "avg_duration_ms"
  | "avg_closure_contribution"
  | "primary_contribution_rate"
  | "regressive_rate"
  | "blocker_trigger_rate"
  | "invocation_count"
  | "workflow_closure_rate"
  | "workflow_efficiency";
export type LocalDistilledFact = CapabilityFact;

export interface LocalDistillationSnapshot {
  contract_id: "local_distillation_v1";
  generated_at: string;
  source_session_count: number;
  source_run_count: number;
  scenario_count: number;
  facts: CapabilityFact[];
}

export interface CapabilityFactOutboxBatch {
  contract_id: "capability_fact_batch_v1";
  batch_id: string;
  state: CapabilityFactOutboxState;
  transport_mode: Exclude<PublicFactSubmitMode, "dry-run"> | null;
  fact_ids: string[];
  fact_count: number;
  facts: CapabilityFact[];
  content_hash: string;
  attempt_count: number;
  last_attempt_at: string | null;
  last_receipt_id: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface CapabilityFactOutboxReceipt {
  contract_id: "capability_fact_receipt_v1";
  receipt_id: string;
  batch_id: string;
  mode: PublicFactSubmitMode;
  result: "claimed" | MockTransportResult;
  from_state: CapabilityFactOutboxState | "dry_run";
  to_state: CapabilityFactOutboxState | "dry_run";
  batch_content_hash: string;
  attempt_number: number;
  response_code: string;
  transport_reference: string | null;
  recorded_at: string;
  metadata: Record<string, unknown>;
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

export interface ManagerUiConfig {
  public_base_url: string | null;
}

export interface HostIntegrationConfig {
  mode: HostIntegrationMode;
  reason: string | null;
}

export interface PublicFactsTransportConfig {
  endpoint: string;
  timeout_ms: number;
  auth_token: string | null;
  schema_version: string;
  auto_submit_enabled: boolean;
  auto_submit_interval_ms: number;
  auto_submit_startup_delay_ms: number;
  auto_submit_max_batch_size: number;
  auto_submit_max_batches: number;
  auto_submit_retry_failed_retryable: boolean;
}

export interface PublicFactsAutoSubmitStatus {
  enabled: boolean;
  mode: "http";
  interval_ms: number;
  startup_delay_ms: number;
  in_flight: boolean;
  total_ticks: number;
  last_tick_at: string | null;
  last_success_at: string | null;
  last_result: {
    selected_fact_count: number;
    created_batch_count: number;
    submitted_batch_count: number;
    receipt_results: Array<string | null>;
  } | null;
  last_error: string | null;
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
  ui: ManagerUiConfig;
  host_integration: HostIntegrationConfig;
  public_facts: PublicFactsTransportConfig;
}

export interface PublicCapabilityFact {
  public_fact_id: string;
  schema_version: string;
  node_fingerprint: string;
  subject_type: CapabilityFactSubjectType;
  subject_ref: string;
  subject_version: string | null;
  scenario_signature: string;
  scenario_tags: string[];
  metric_name: string;
  metric_value: number | string | boolean;
  sample_size: number;
  confidence: number;
  context?: Record<string, unknown>;
  computed_at: string;
  submitted_at: string;
}

export interface PublicCapabilityFactBatchRequest {
  schema_version: string;
  node_fingerprint: string;
  batch_id: string;
  submitted_at: string;
  facts: PublicCapabilityFact[];
}

export interface PublicCapabilityFactBatchResponse {
  status: "accepted" | "duplicate" | "partial" | "rejected";
  batch_id: string;
  accepted_count?: number;
  rejected_count?: number;
  rejected_facts?: Array<{ public_fact_id: string; reason: string }>;
  receipt_id?: string | null;
}

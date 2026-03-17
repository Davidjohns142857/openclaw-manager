import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AdoptSessionInput,
  BindingListFilters,
  BindSourceInput,
  BindSourceResult,
  ClearBlockerInput,
  CloseSessionInput,
  DisableBindingInput,
  DisableBindingResult,
  InboundHandlingResult,
  RequestHumanDecisionInput,
  RebindSourceInput,
  RebindSourceResult,
  RunSettlementResult,
  SessionTimelineView,
  ReservedContractMutationResult,
  ResolveHumanDecisionInput,
  DetectBlockerInput,
  ResumeSessionResult,
  SettleRunInput,
  ShareSnapshotResult
} from "../shared/contracts.ts";
import type { Checkpoint, ManagerConfig, Run, RunTrigger, Session } from "../shared/types.ts";
import {
  buildSettledRunOutcome,
  canAdvanceRecoveryHeadForRunStatus,
  isPausedRunStatus,
  shouldAutoStartRunOnResume,
  projectSessionStatusAfterRun
} from "../shared/run-lifecycle.ts";
import {
  applyDerivedSessionStatus,
  readSessionStatusReason,
  sameSessionStatusReason
} from "../shared/session-status.ts";
import { isoNow } from "../shared/time.ts";
import { canAutoContinueSession, isTerminalSessionStatus } from "../shared/state.ts";
import { renderTemplate } from "../shared/template.ts";
import { buildSessionIndexes } from "../storage/indexes.ts";
import { FilesystemStore } from "../storage/fs-store.ts";
import { InProcessLock } from "../storage/locks.ts";
import {
  normalizeInboundMessage,
  type ExternalInboundMessageInput,
  type NormalizeInboundMessageInput
} from "../connectors/base.ts";
import { CapabilityFactService } from "../telemetry/capability-facts.ts";
import { SkillTraceService } from "../telemetry/skill-trace.ts";
import { TimelineService } from "../timeline/timeline-service.ts";
import { AttentionService } from "./attention-service.ts";
import {
  BindingService,
  ConnectorBindingConflictError,
  ConnectorBindingNotFoundError
} from "./binding-service.ts";
import { CheckpointService } from "./checkpoint-service.ts";
import { EventService } from "./event-service.ts";
import { RunService } from "./run-service.ts";
import { ReservedContractService } from "./reserved-contract-service.ts";
import { SessionService } from "./session-service.ts";
import { ShareService } from "./share-service.ts";

function checkpointRef(runId: string): string {
  return `runs/${runId}/checkpoint.json`;
}

export class ControlPlane {
  config: ManagerConfig;
  store: FilesystemStore;
  eventService: EventService;
  sessionService: SessionService;
  runService: RunService;
  checkpointService: CheckpointService;
  attentionService: AttentionService;
  bindingService: BindingService;
  shareService: ShareService;
  skillTraceService: SkillTraceService;
  capabilityFactService: CapabilityFactService;
  reservedContractService: ReservedContractService;
  timelineService: TimelineService;
  sessionMutationLocks: Map<string, InProcessLock>;

  constructor(config: ManagerConfig, store: FilesystemStore) {
    this.config = config;
    this.store = store;
    this.eventService = new EventService(store);
    this.sessionService = new SessionService(store);
    this.runService = new RunService(store, this.eventService);
    this.checkpointService = new CheckpointService(config, store, this.eventService);
    this.attentionService = new AttentionService();
    this.bindingService = new BindingService(store, this.sessionService, this.eventService);
    this.shareService = new ShareService(config, store);
    this.skillTraceService = new SkillTraceService(store);
    this.capabilityFactService = new CapabilityFactService();
    this.reservedContractService = new ReservedContractService(
      this.sessionService,
      this.eventService
    );
    this.timelineService = new TimelineService(store);
    this.sessionMutationLocks = new Map();
  }

  async initialize(): Promise<void> {
    await this.store.ensureLayout();
    await this.refreshDerivedViews();
  }

  async listTasks(): Promise<Session[]> {
    return this.sessionService.listSessions();
  }

  async getLatestRun(sessionId: string): Promise<Run | null> {
    const [run] = await this.store.listRuns(sessionId);
    return run ?? null;
  }

  private async resolveRecoverySourceRun(sessionId: string): Promise<Run | null> {
    const runs = await this.store.listRuns(sessionId);
    const latestTerminalHead = runs.find((run) => run.execution.end_checkpoint_ref !== null);

    if (latestTerminalHead) {
      return latestTerminalHead;
    }

    const latestRecoveryCheckpoint = runs.find(
      (run) => run.execution.recovery_checkpoint_ref !== null
    );

    return latestRecoveryCheckpoint ?? runs[0] ?? null;
  }

  private async readCommittedRecoveryState(
    sessionId: string,
    run: Run | null
  ): Promise<{ checkpoint: Checkpoint | null; summary: string | null }> {
    if (!run) {
      return {
        checkpoint: null,
        summary: await this.store.readSummary(sessionId)
      };
    }

    return {
      checkpoint: await this.store.readCheckpoint(sessionId, run.run_id),
      summary: await this.store.readRecoverySummary(sessionId, run.run_id)
    };
  }

  async getSessionDetail(sessionId: string): Promise<{
    session: Session;
    run: Run | null;
    checkpoint: Checkpoint | null;
    summary: string | null;
  }> {
    const storedSession = await this.sessionService.requireSession(sessionId);
    const run = storedSession.active_run_id
      ? await this.store.readRun(storedSession.session_id, storedSession.active_run_id)
      : await this.getLatestRun(storedSession.session_id);
    const session = await this.projectSessionSummary(storedSession, run);
    const recoverySourceRun = run ?? (await this.resolveRecoverySourceRun(storedSession.session_id));
    const { checkpoint, summary } = await this.readCommittedRecoveryState(
      session.session_id,
      recoverySourceRun
    );

    return { session, run, checkpoint, summary };
  }

  async getSessionTimeline(sessionId: string): Promise<SessionTimelineView> {
    const storedSession = await this.sessionService.requireSession(sessionId);
    const runs = await this.store.listRuns(storedSession.session_id);
    const currentRun = storedSession.active_run_id
      ? await this.store.readRun(storedSession.session_id, storedSession.active_run_id)
      : runs[0] ?? null;
    const session = await this.projectSessionSummary(storedSession, currentRun);

    return this.timelineService.buildSessionTimeline(session, currentRun, runs);
  }

  private async projectSessionSummary(session: Session, latestRun: Run | null): Promise<Session> {
    const projected = applyDerivedSessionStatus(session, latestRun);
    const currentReason = readSessionStatusReason(session);
    const projectedReason = readSessionStatusReason(projected);

    if (session.status === projected.status && sameSessionStatusReason(currentReason, projectedReason!)) {
      return session;
    }

    return this.sessionService.saveSession(projected);
  }

  private async saveProjectedSession(session: Session, latestRun: Run | null): Promise<Session> {
    return this.sessionService.saveSession(applyDerivedSessionStatus(session, latestRun));
  }

  private sessionMutationLock(sessionId: string): InProcessLock {
    let existing = this.sessionMutationLocks.get(sessionId);

    if (!existing) {
      existing = new InProcessLock();
      this.sessionMutationLocks.set(sessionId, existing);
    }

    return existing;
  }

  private async withSessionMutationLock<T>(
    sessionId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.sessionMutationLock(sessionId).runExclusive(operation);
  }

  private async resolveRunStartCheckpointRef(session: Session): Promise<string | null> {
    const recoverySourceRun = await this.resolveRecoverySourceRun(session.session_id);

    if (recoverySourceRun?.execution.end_checkpoint_ref) {
      return recoverySourceRun.execution.end_checkpoint_ref;
    }

    if (recoverySourceRun?.execution.recovery_checkpoint_ref) {
      return recoverySourceRun.execution.recovery_checkpoint_ref;
    }

    return session.latest_checkpoint_ref;
  }

  private async startRunForSession(session: Session, trigger: RunTrigger): Promise<Run> {
    return this.runService.startRun(session, trigger, {
      startCheckpointRef: await this.resolveRunStartCheckpointRef(session)
    });
  }

  async adoptSession(input: AdoptSessionInput): Promise<{ session: Session; run: Run }> {
    let session = await this.sessionService.createSession(input);
    let run = await this.startRunForSession(session, {
      trigger_type: "manual",
      trigger_ref: null,
      request_id: null,
      external_trigger_id: null
    });

    session.active_run_id = run.run_id;
    session.metrics.run_count += 1;
    session.metrics.last_activity_at = run.started_at;
    session.latest_checkpoint_ref = checkpointRef(run.run_id);
    session.metadata.summary_needs_refresh = true;
    session = await this.sessionService.saveSession(session);

    await this.checkpointService.refreshRecoveryArtifacts(session, run, [
      "Session adopted into the durable control plane."
    ]);
    run = await this.runService.syncCommittedRecoveryRefs(session.session_id, run.run_id, {
      checkpointRef: checkpointRef(run.run_id),
      summaryRef: "summary.md",
      markAsTerminal: false
    });

    session.latest_summary_ref = "summary.md";
    session.latest_checkpoint_ref = checkpointRef(run.run_id);
    session.metadata.summary_needs_refresh = false;
    session = await this.saveProjectedSession(session, run);

    await this.refreshDerivedViews();
    return { session, run };
  }

  async resumeSession(sessionId: string): Promise<ResumeSessionResult> {
    let session = await this.sessionService.requireSession(sessionId);
    const pendingExternalInputs = [...session.state.pending_external_inputs];
    let run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : null;
    const latestRun = run ?? (await this.getLatestRun(session.session_id));
    const recoverySourceRun = run ?? (await this.resolveRecoverySourceRun(session.session_id));
    let { checkpoint, summary } = await this.readCommittedRecoveryState(
      session.session_id,
      recoverySourceRun
    );

    if (
      recoverySourceRun &&
      !checkpoint &&
      canAdvanceRecoveryHeadForRunStatus(recoverySourceRun.status)
    ) {
      throw new Error(
        `Recovery checkpoint missing or uncommitted for session ${session.session_id} run ${recoverySourceRun.run_id}. Refresh explicitly before resuming.`
      );
    }

    if (recoverySourceRun && checkpoint) {
      session = this.checkpointService.applyCheckpoint(session, checkpoint);
      session.state.pending_external_inputs = Array.from(
        new Set([...checkpoint.pending_external_inputs, ...pendingExternalInputs])
      );
      session.metadata.pending_inbound_count = session.state.pending_external_inputs.length;
      session.latest_checkpoint_ref = checkpointRef(checkpoint.run_id);
      session = await this.saveProjectedSession(session, latestRun);
    }

    if (recoverySourceRun && checkpoint && !summary) {
      summary = await this.checkpointService.renderSummary(session, recoverySourceRun, checkpoint, [
        "Summary regenerated from committed checkpoint."
      ]);
      await this.store.writeCommittedRecoverySummary(
        session.session_id,
        recoverySourceRun.run_id,
        summary
      );
      const refreshedRecoveryRun = await this.runService.syncCommittedRecoveryRefs(
        session.session_id,
        recoverySourceRun.run_id,
        {
          checkpointRef: checkpointRef(recoverySourceRun.run_id),
          summaryRef: "summary.md",
          markAsTerminal:
            isPausedRunStatus(recoverySourceRun.status) || recoverySourceRun.status === "completed"
        }
      );
      if (latestRun?.run_id === refreshedRecoveryRun.run_id) {
        run = refreshedRecoveryRun;
      }
      session.latest_summary_ref = "summary.md";
      session.latest_checkpoint_ref = checkpointRef(recoverySourceRun.run_id);
      session.metadata.summary_needs_refresh = false;
      session = await this.sessionService.saveSession(session);
      await this.eventService.record({
        sessionId: session.session_id,
        runId: recoverySourceRun.run_id,
        eventType: "summary_refreshed",
        payload: {
          summary_ref: "summary.md",
          regenerated_from: "checkpoint"
        }
      });
      await this.refreshDerivedViews();
    }

    session = await this.saveProjectedSession(session, run ?? latestRun);

    if (!run && !isTerminalSessionStatus(session.status) && shouldAutoStartRunOnResume(session, latestRun)) {
      const pendingInputs = [...session.state.pending_external_inputs];
      run = await this.startRunForSession(session, {
        trigger_type: "resume",
        trigger_ref: null,
        request_id: null,
        external_trigger_id: null
      });

      session.active_run_id = run.run_id;
      session.metrics.run_count += 1;
      session.metrics.last_activity_at = run.started_at;
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session.state.pending_external_inputs = [];
      session.metadata.pending_inbound_count = 0;
      session.metadata.summary_needs_refresh = true;
      session = await this.sessionService.saveSession(session);

      const refreshed = await this.checkpointService.refreshRecoveryArtifacts(session, run, [
        pendingInputs.length > 0
          ? `Session resumed and consumed ${pendingInputs.length} queued inbound update(s).`
          : "Session resumed from checkpoint."
      ]);
      run = await this.runService.syncCommittedRecoveryRefs(session.session_id, run.run_id, {
        checkpointRef: checkpointRef(run.run_id),
        summaryRef: "summary.md",
        markAsTerminal: false
      });
      session.latest_summary_ref = "summary.md";
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session.metadata.summary_needs_refresh = false;
      session = await this.saveProjectedSession(session, run);

      await this.refreshDerivedViews();
      return {
        session,
        run,
        checkpoint: refreshed.checkpoint,
        summary: refreshed.summary
      };
    }

    session = await this.saveProjectedSession(session, run ?? latestRun);
    return { session, run: run ?? latestRun, checkpoint, summary };
  }

  async refreshCheckpoint(sessionId: string): Promise<ResumeSessionResult> {
    let session = await this.sessionService.requireSession(sessionId);
    let run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : await this.getLatestRun(session.session_id);

    session = await this.saveProjectedSession(session, run);

    if (!run && !isTerminalSessionStatus(session.status)) {
      if (shouldAutoStartRunOnResume(session, null)) {
        run = await this.startRunForSession(session, {
          trigger_type: "manual",
          trigger_ref: null,
          request_id: null,
          external_trigger_id: null
        });

        session.active_run_id = run.run_id;
        session.metrics.run_count += 1;
        session.metrics.last_activity_at = run.started_at;
        session.latest_checkpoint_ref = checkpointRef(run.run_id);
        session = await this.saveProjectedSession(session, run);
      }
    }

    if (!run) {
      return {
        session,
        run: null,
        checkpoint: null,
        summary: await this.store.readSummary(session.session_id)
      };
    }

    if (
      !session.active_run_id &&
      !canAdvanceRecoveryHeadForRunStatus(run.status) &&
      run.status !== "running"
    ) {
      const recoverySourceRun = await this.resolveRecoverySourceRun(session.session_id);
      const { checkpoint, summary } = await this.readCommittedRecoveryState(
        session.session_id,
        recoverySourceRun
      );
      return {
        session,
        run,
        checkpoint,
        summary
      };
    }

    const refreshed = await this.checkpointService.refreshRecoveryArtifacts(session, run, [
      "Checkpoint refreshed on demand."
    ]);
    run = await this.runService.syncCommittedRecoveryRefs(session.session_id, run.run_id, {
      checkpointRef: checkpointRef(run.run_id),
      summaryRef: "summary.md",
      markAsTerminal: !session.active_run_id && canAdvanceRecoveryHeadForRunStatus(run.status)
    });

    session.latest_summary_ref = "summary.md";
    session.latest_checkpoint_ref = checkpointRef(run.run_id);
    session.metadata.summary_needs_refresh = false;
    session = await this.saveProjectedSession(session, run);

    await this.refreshDerivedViews();

    return {
      session,
      run,
      checkpoint: refreshed.checkpoint,
      summary: refreshed.summary
    };
  }

  async settleActiveRun(sessionId: string, input: SettleRunInput): Promise<RunSettlementResult> {
    let session = await this.sessionService.requireSession(sessionId);
    if (!session.active_run_id) {
      throw new Error(`Session ${sessionId} has no active run to settle.`);
    }

    const activeRun = await this.store.readRun(session.session_id, session.active_run_id);
    if (!activeRun) {
      throw new Error(`Active run ${session.active_run_id} could not be loaded for ${sessionId}.`);
    }

    if (input.blockers) {
      session.state.blockers = input.blockers;
    }
    if (input.pending_human_decisions) {
      session.state.pending_human_decisions = input.pending_human_decisions;
    }
    if (input.next_machine_actions) {
      session.state.next_machine_actions = input.next_machine_actions;
    }
    if (input.next_human_actions) {
      session.state.next_human_actions = input.next_human_actions;
    }

    const outcome = buildSettledRunOutcome(input.status, {
      result_type: input.result_type,
      summary: input.summary ?? defaultRunOutcomeSummary(input.status, input.result_type ?? null),
      reason_code: input.reason_code ?? null
    });
    let run = await this.runService.transitionRun(
      session.session_id,
      activeRun.run_id,
      input.status,
      outcome
    );

    session.active_run_id = null;
    session.status = projectSessionStatusAfterRun(session, run);
    session.metrics.last_activity_at = run.ended_at ?? isoNow();
    session.metadata.summary_needs_refresh = true;

    if (input.status === "waiting_human") {
      session.metrics.human_intervention_count += 1;
    }
    if (input.status === "failed") {
      session.metrics.failed_run_count += 1;
    }

    session = await this.saveProjectedSession(session, run);

    let checkpoint: Checkpoint | null = null;
    let summary: string | null = null;
    const recoveryHeadAdvanced = canAdvanceRecoveryHeadForRunStatus(input.status);

    if (recoveryHeadAdvanced) {
      const refreshed = await this.checkpointService.refreshRecoveryArtifacts(session, run, [
        ...(input.checkpoint_notes ?? []),
        input.summary ?? defaultRunOutcomeSummary(input.status, run.outcome.result_type)
      ]);
      run = await this.runService.syncCommittedRecoveryRefs(session.session_id, run.run_id, {
        checkpointRef: checkpointRef(run.run_id),
        summaryRef: "summary.md",
        markAsTerminal: true
      });
      checkpoint = refreshed.checkpoint;
      summary = refreshed.summary;
      session.latest_summary_ref = "summary.md";
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session.metadata.summary_needs_refresh = false;
      session = await this.saveProjectedSession(session, run);
    }

    await this.refreshDerivedViews();

    return {
      session,
      run,
      checkpoint,
      summary,
      recovery_head_advanced: recoveryHeadAdvanced
    };
  }

  async listBindings() {
    return this.bindingService.listBindings();
  }

  async listBindingsWithFilters(filters: BindingListFilters) {
    return this.bindingService.listBindings(filters);
  }

  async bindSource(input: BindSourceInput): Promise<BindSourceResult> {
    const session = await this.sessionService.requireSession(input.session_id);
    const run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : await this.getLatestRun(session.session_id);
    const bound = await this.bindingService.bindSource(session, run, input);

    await this.refreshDerivedViews();

    const detail = await this.getSessionDetail(bound.session.session_id);
    return {
      binding: bound.binding,
      created: bound.created,
      session: detail.session,
      run: detail.run,
      checkpoint: detail.checkpoint,
      summary: detail.summary
    };
  }

  async disableBinding(
    bindingId: string,
    input: DisableBindingInput
  ): Promise<DisableBindingResult> {
    const disabled = await this.bindingService.disableBinding(bindingId, input);

    await this.refreshDerivedViews();

    const detail = await this.getSessionDetail(disabled.session.session_id);
    return {
      binding: disabled.binding,
      changed: disabled.changed,
      session: detail.session,
      run: detail.run,
      checkpoint: detail.checkpoint,
      summary: detail.summary
    };
  }

  async rebindBinding(
    bindingId: string,
    input: RebindSourceInput
  ): Promise<RebindSourceResult> {
    const targetSession = await this.sessionService.requireSession(input.session_id);
    const rebound = await this.bindingService.rebindBinding(bindingId, targetSession, input);

    await this.refreshDerivedViews();

    const detail = await this.getSessionDetail(rebound.session.session_id);
    return {
      binding: rebound.binding,
      previous_session_id: rebound.previousSessionId,
      changed: rebound.changed,
      session: detail.session,
      run: detail.run,
      checkpoint: detail.checkpoint,
      summary: detail.summary
    };
  }

  async resolveInboundTargetSessionId(
    sourceType: string,
    sourceThreadKey: string,
    explicitTargetSessionId?: string
  ): Promise<string> {
    return this.bindingService.resolveTargetSessionId(
      sourceType,
      sourceThreadKey,
      explicitTargetSessionId
    );
  }

  async handleExternalInboundMessage(
    input: ExternalInboundMessageInput
  ): Promise<InboundHandlingResult> {
    const targetSessionId = await this.resolveInboundTargetSessionId(
      input.source_type,
      input.source_thread_key,
      input.target_session_id
    );

    return this.handleInboundMessage({
      ...input,
      target_session_id: targetSessionId
    });
  }

  private async buildReservedContractResult(
    sessionId: string,
    meta: Omit<ReservedContractMutationResult, "session" | "run" | "checkpoint" | "summary">
  ): Promise<ReservedContractMutationResult> {
    const detail = await this.getSessionDetail(sessionId);

    return {
      ...meta,
      session: detail.session,
      run: detail.run,
      checkpoint: detail.checkpoint,
      summary: detail.summary
    };
  }

  async requestHumanDecision(
    sessionId: string,
    input: RequestHumanDecisionInput
  ): Promise<ReservedContractMutationResult> {
    if (!this.config.features.decision_lifecycle_v1) {
      return this.buildReservedContractResult(sessionId, {
        contract_id: "session_decision_request_v1",
        feature_flag: "decision_lifecycle_v1",
        status: "not_enabled",
        error_code: "FEATURE_NOT_ENABLED",
        mutation_applied: false
      });
    }

    const session = await this.sessionService.requireSession(sessionId);
    const run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : await this.getLatestRun(session.session_id);
    const outcome = await this.reservedContractService.requestHumanDecision(session, run, input);

    await this.refreshDerivedViews();

    return this.buildReservedContractResult(sessionId, {
      contract_id: "session_decision_request_v1",
      feature_flag: "decision_lifecycle_v1",
      status: outcome.applied ? "accepted" : "rejected",
      error_code: outcome.errorCode,
      mutation_applied: outcome.applied
    });
  }

  async resolveHumanDecision(
    sessionId: string,
    decisionId: string,
    input: ResolveHumanDecisionInput
  ): Promise<ReservedContractMutationResult> {
    if (!this.config.features.decision_lifecycle_v1) {
      return this.buildReservedContractResult(sessionId, {
        contract_id: "session_decision_resolve_v1",
        feature_flag: "decision_lifecycle_v1",
        status: "not_enabled",
        error_code: "FEATURE_NOT_ENABLED",
        mutation_applied: false
      });
    }

    const session = await this.sessionService.requireSession(sessionId);
    const run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : await this.getLatestRun(session.session_id);
    const outcome = await this.reservedContractService.resolveHumanDecision(
      session,
      run,
      decisionId,
      input
    );

    await this.refreshDerivedViews();

    return this.buildReservedContractResult(sessionId, {
      contract_id: "session_decision_resolve_v1",
      feature_flag: "decision_lifecycle_v1",
      status: outcome.applied ? "accepted" : "rejected",
      error_code: outcome.errorCode,
      mutation_applied: outcome.applied
    });
  }

  async detectBlocker(
    sessionId: string,
    input: DetectBlockerInput
  ): Promise<ReservedContractMutationResult> {
    if (!this.config.features.blocker_lifecycle_v1) {
      return this.buildReservedContractResult(sessionId, {
        contract_id: "session_blocker_detect_v1",
        feature_flag: "blocker_lifecycle_v1",
        status: "not_enabled",
        error_code: "FEATURE_NOT_ENABLED",
        mutation_applied: false
      });
    }

    const session = await this.sessionService.requireSession(sessionId);
    const run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : await this.getLatestRun(session.session_id);
    const outcome = await this.reservedContractService.detectBlocker(session, run, input);

    await this.refreshDerivedViews();

    return this.buildReservedContractResult(sessionId, {
      contract_id: "session_blocker_detect_v1",
      feature_flag: "blocker_lifecycle_v1",
      status: outcome.applied ? "accepted" : "rejected",
      error_code: outcome.errorCode,
      mutation_applied: outcome.applied
    });
  }

  async clearBlocker(
    sessionId: string,
    blockerId: string,
    input: ClearBlockerInput
  ): Promise<ReservedContractMutationResult> {
    if (!this.config.features.blocker_lifecycle_v1) {
      return this.buildReservedContractResult(sessionId, {
        contract_id: "session_blocker_clear_v1",
        feature_flag: "blocker_lifecycle_v1",
        status: "not_enabled",
        error_code: "FEATURE_NOT_ENABLED",
        mutation_applied: false
      });
    }

    const session = await this.sessionService.requireSession(sessionId);
    const run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : await this.getLatestRun(session.session_id);
    const outcome = await this.reservedContractService.clearBlocker(
      session,
      run,
      blockerId,
      input
    );

    await this.refreshDerivedViews();

    return this.buildReservedContractResult(sessionId, {
      contract_id: "session_blocker_clear_v1",
      feature_flag: "blocker_lifecycle_v1",
      status: outcome.applied ? "accepted" : "rejected",
      error_code: outcome.errorCode,
      mutation_applied: outcome.applied
    });
  }

  async focus(): Promise<ReturnType<AttentionService["buildAttentionQueue"]>> {
    await this.refreshDerivedViews();
    return (await this.store.readAttentionQueue()) ?? [];
  }

  async digest(): Promise<string> {
    const [sessions, attentionQueue, template] = await Promise.all([
      this.listTasks(),
      this.focus(),
      readFile(path.join(this.config.templatesDir, "focus-digest.md"), "utf8")
    ]);
    const sessionMap = new Map(sessions.map((session) => [session.session_id, session]));
    const attentionItems =
      attentionQueue.length === 0
        ? "- None"
        : attentionQueue
            .slice(0, 5)
            .map((item, index) => {
              const session = sessionMap.get(item.session_id);
              return `${index + 1}. ${session?.title ?? item.session_id} :: ${item.category} :: ${item.recommended_next_step}`;
            })
            .join("\n");
    const quietSessions = sessions
      .filter((session) => !attentionQueue.some((item) => item.session_id === session.session_id))
      .slice(0, 10)
      .map((session) => `- ${session.title} (${session.status})`)
      .join("\n") || "- None";

    return renderTemplate(template, {
      generated_at: isoNow(),
      attention_items: attentionItems,
      quiet_sessions: quietSessions
    });
  }

  async shareSession(sessionId: string): Promise<ShareSnapshotResult> {
    let session = await this.sessionService.requireSession(sessionId);
    const run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : await this.getLatestRun(session.session_id);
    let summary = run
      ? await this.store.readRecoverySummary(sessionId, run.run_id)
      : await this.store.readSummary(sessionId);

    if (!summary && run) {
      const refreshed = await this.checkpointService.refreshRecoveryArtifacts(session, run, [
        "Summary refreshed for snapshot export."
      ]);
      summary = refreshed.summary;
      session.latest_summary_ref = "summary.md";
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session.metadata.summary_needs_refresh = false;
      session = await this.sessionService.saveSession(session);
    }

    const snapshot = await this.shareService.createSnapshot(
      session,
      summary ?? "# Summary unavailable\n",
      run
    );

    session.sharing.latest_snapshot_id = snapshot.snapshot_id;
    session = await this.sessionService.saveSession(session);

    await this.eventService.record({
      sessionId: session.session_id,
      runId: run?.run_id ?? null,
      eventType: "session_shared",
      payload: {
        snapshot_id: snapshot.snapshot_id
      }
    });

    await this.refreshDerivedViews();
    return snapshot;
  }

  async closeSession(sessionId: string, input: CloseSessionInput): Promise<Session> {
    let session = await this.sessionService.requireSession(sessionId);
    let run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : await this.getLatestRun(session.session_id);

    if (run && session.active_run_id === run.run_id) {
      const runStatus = "completed";
      run = await this.runService.transitionRun(
        session.session_id,
        run.run_id,
        runStatus,
        buildSettledRunOutcome(runStatus, {
          result_type: input.resolution === "abandoned" ? "no_op" : "completed",
          summary: input.outcome_summary,
          reason_code: input.resolution === "abandoned" ? "session_abandoned" : "session_closed"
        })
      );
    }

    session.active_run_id = null;
    session.status = input.resolution === "abandoned" ? "abandoned" : "completed";
    session.lifecycle_stage = "closure";
    session.state.goal_status = input.resolution === "abandoned" ? "abandoned" : "complete";
    session.state.blockers = [];
    session.state.pending_human_decisions = [];
    session.state.pending_external_inputs = [];
    session.state.next_machine_actions = [];
    session.state.next_human_actions = [];
    session.metrics.last_activity_at = isoNow();
    session.metadata.pending_inbound_count = 0;
    session.metadata.summary_needs_refresh = true;
    session = await this.saveProjectedSession(session, run);

    if (run) {
      const refreshed = await this.checkpointService.refreshRecoveryArtifacts(session, run, [
        input.outcome_summary
      ]);
      run = await this.runService.syncCommittedRecoveryRefs(session.session_id, run.run_id, {
        checkpointRef: checkpointRef(run.run_id),
        summaryRef: "summary.md",
        markAsTerminal: true
      });

      session.latest_summary_ref = "summary.md";
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session.metadata.summary_needs_refresh = false;
      session = await this.saveProjectedSession(session, run);

      await this.eventService.record({
        sessionId: session.session_id,
        runId: run.run_id,
        eventType: "session_closed",
        payload: {
          resolution: session.status,
          outcome_summary: input.outcome_summary
        }
      });

      const facts = this.capabilityFactService.emitClosureFacts(session, run);
      await this.store.appendCapabilityFacts(facts);
      await this.eventService.record({
        sessionId: session.session_id,
        runId: run.run_id,
        eventType: "capability_fact_emitted",
        payload: {
          fact_count: facts.length
        }
      });
    } else {
      await this.eventService.record({
        sessionId: session.session_id,
        eventType: "session_closed",
        payload: {
          resolution: session.status,
          outcome_summary: input.outcome_summary
        }
      });
    }

    await this.refreshDerivedViews();
    return session;
  }

  async handleInboundMessage(input: NormalizeInboundMessageInput): Promise<InboundHandlingResult> {
    const message = normalizeInboundMessage(input);
    const claim = await this.store.tryClaimInboundMessage(message);

    if (claim.status === "duplicate" && claim.existing) {
      if (claim.existing.target_session_id !== message.target_session_id) {
        throw new Error(
          `request_id ${message.request_id} already belongs to session ${claim.existing.target_session_id}`
        );
      }

      const session = await this.sessionService.requireSession(claim.existing.target_session_id);
      const run = session.active_run_id
        ? await this.store.readRun(session.session_id, session.active_run_id)
        : await this.getLatestRun(session.session_id);

      return {
        message: claim.existing,
        session,
        run,
        run_started: false,
        duplicate: true,
        queued: false
      };
    }

    const result = await this.withSessionMutationLock(message.target_session_id, async () => {
      let session = await this.sessionService.requireSession(message.target_session_id);
      const latestRun = session.active_run_id
        ? await this.store.readRun(session.session_id, session.active_run_id)
        : await this.getLatestRun(session.session_id);

      await this.eventService.record({
        sessionId: session.session_id,
        eventType: "message_received",
        actor: {
          actor_type: "external",
          actor_ref: message.source_type
        },
        causality: {
          request_id: message.request_id,
          external_trigger_id: message.external_trigger_id
        },
        payload: {
          source_thread_key: message.source_thread_key,
          message_type: message.message_type
        }
      });
      await this.eventService.record({
        sessionId: session.session_id,
        eventType: "message_normalized",
        actor: {
          actor_type: "system",
          actor_ref: "connector.normalizer"
        },
        causality: {
          request_id: message.request_id,
          external_trigger_id: message.external_trigger_id
        },
        payload: {
          request_id: message.request_id
        }
      });

      session.state.pending_external_inputs = Array.from(
        new Set([...session.state.pending_external_inputs, message.request_id])
      );
      session.metadata.pending_inbound_count = session.state.pending_external_inputs.length;
      session.metrics.last_activity_at = message.timestamp;
      session.metadata.summary_needs_refresh = true;
      session = await this.sessionService.saveSession(session);

      let run: Run | null = null;
      let runStarted = false;

      if (canAutoContinueSession(session, latestRun) && !session.active_run_id) {
        run = await this.startRunForSession(session, {
          trigger_type: "external_message",
          trigger_ref: null,
          request_id: message.request_id,
          external_trigger_id: message.external_trigger_id
        });

        session.active_run_id = run.run_id;
        session.metrics.run_count += 1;
        session.metrics.last_activity_at = run.started_at;
        session.state.pending_external_inputs = session.state.pending_external_inputs.filter(
          (requestId) => requestId !== message.request_id
        );
        session.metadata.pending_inbound_count = session.state.pending_external_inputs.length;
        session.latest_checkpoint_ref = checkpointRef(run.run_id);
        session = await this.sessionService.saveSession(session);

        await this.checkpointService.refreshRecoveryArtifacts(session, run, [
          `Inbound message accepted from ${message.source_type}.`
        ]);
        run = await this.runService.syncCommittedRecoveryRefs(session.session_id, run.run_id, {
          checkpointRef: checkpointRef(run.run_id),
          summaryRef: "summary.md",
          markAsTerminal: false
        });

        session.latest_summary_ref = "summary.md";
        session.latest_checkpoint_ref = checkpointRef(run.run_id);
        session.metadata.summary_needs_refresh = false;
        session = await this.saveProjectedSession(session, run);
        runStarted = true;
      } else {
        session = await this.saveProjectedSession(session, latestRun);
      }

      return {
        message,
        session,
        run,
        run_started: runStarted,
        duplicate: false,
        queued: !runStarted
      };
    });

    await this.refreshDerivedViews();

    return result;
  }

  static ConnectorBindingConflictError = ConnectorBindingConflictError;
  static ConnectorBindingNotFoundError = ConnectorBindingNotFoundError;

  async refreshDerivedViews(): Promise<void> {
    const storedSessions = await this.sessionService.listSessions();
    const sessions = await Promise.all(
      storedSessions.map(async (session) => {
        const latestRun = session.active_run_id
          ? await this.store.readRun(session.session_id, session.active_run_id)
          : await this.getLatestRun(session.session_id);

        return this.projectSessionSummary(session, latestRun);
      })
    );
    const sessionIndexes = buildSessionIndexes(sessions);
    const attentionQueue = this.attentionService.buildAttentionQueue(sessions);
    const attentionBySession = new Map<string, ReturnType<AttentionService["buildAttentionForSession"]>>();

    for (const session of sessions) {
      attentionBySession.set(
        session.session_id,
        attentionQueue.filter((item) => item.session_id === session.session_id)
      );
    }

    await Promise.all([
      this.store.writeSessionIndexes(sessionIndexes.sessions, sessionIndexes.activeSessions),
      this.store.writeAttentionQueue(attentionQueue),
      ...sessions.map((session) =>
        this.store.writeAttention(session.session_id, attentionBySession.get(session.session_id) ?? [])
      )
    ]);
  }
}

function defaultRunOutcomeSummary(
  status: SettleRunInput["status"],
  resultType: SettleRunInput["result_type"] | null = null
): string {
  switch (status) {
    case "waiting_human":
      return "Run paused pending human input.";
    case "blocked":
      return "Run ended in a blocked state.";
    case "completed":
      if (resultType === "partial_progress") {
        return "Run ended with partial progress.";
      }

      if (resultType === "no_op") {
        return "Run ended cleanly without changing task closure.";
      }

      return "Run completed successfully.";
    case "failed":
      return "Run failed and needs review.";
    case "cancelled":
      return "Run was cancelled.";
    case "superseded":
      return "Run was superseded by a newer execution.";
  }
}

import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AdoptSessionInput,
  ClearBlockerInput,
  CloseSessionInput,
  InboundHandlingResult,
  RequestHumanDecisionInput,
  ReservedContractMutationResult,
  ResolveHumanDecisionInput,
  DetectBlockerInput,
  ResumeSessionResult,
  ShareSnapshotResult
} from "../shared/contracts.ts";
import type { Checkpoint, ManagerConfig, Run, Session } from "../shared/types.ts";
import { isoNow } from "../shared/time.ts";
import { canAutoContinueSession, isTerminalSessionStatus } from "../shared/state.ts";
import { renderTemplate } from "../shared/template.ts";
import { buildSessionIndexes } from "../storage/indexes.ts";
import { FilesystemStore } from "../storage/fs-store.ts";
import { normalizeInboundMessage, type NormalizeInboundMessageInput } from "../connectors/base.ts";
import { CapabilityFactService } from "../telemetry/capability-facts.ts";
import { SkillTraceService } from "../telemetry/skill-trace.ts";
import { AttentionService } from "./attention-service.ts";
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
  shareService: ShareService;
  skillTraceService: SkillTraceService;
  capabilityFactService: CapabilityFactService;
  reservedContractService: ReservedContractService;

  constructor(config: ManagerConfig, store: FilesystemStore) {
    this.config = config;
    this.store = store;
    this.eventService = new EventService(store);
    this.sessionService = new SessionService(store);
    this.runService = new RunService(store, this.eventService);
    this.checkpointService = new CheckpointService(config, store, this.eventService);
    this.attentionService = new AttentionService();
    this.shareService = new ShareService(config, store);
    this.skillTraceService = new SkillTraceService(store);
    this.capabilityFactService = new CapabilityFactService();
    this.reservedContractService = new ReservedContractService(
      this.sessionService,
      this.eventService
    );
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

  async getSessionDetail(sessionId: string): Promise<{
    session: Session;
    run: Run | null;
    checkpoint: Checkpoint | null;
    summary: string | null;
  }> {
    const session = await this.sessionService.requireSession(sessionId);
    const run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : await this.getLatestRun(session.session_id);
    const checkpoint = run ? await this.store.readCheckpoint(session.session_id, run.run_id) : null;
    const summary = run
      ? await this.store.readRecoverySummary(session.session_id, run.run_id)
      : await this.store.readSummary(session.session_id);

    return { session, run, checkpoint, summary };
  }

  async adoptSession(input: AdoptSessionInput): Promise<{ session: Session; run: Run }> {
    let session = await this.sessionService.createSession(input);
    const run = await this.runService.startRun(session, {
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

    session.latest_summary_ref = "summary.md";
    session.latest_checkpoint_ref = checkpointRef(run.run_id);
    session.metadata.summary_needs_refresh = false;
    session = await this.sessionService.saveSession(session);

    await this.refreshDerivedViews();
    return { session, run };
  }

  async resumeSession(sessionId: string): Promise<ResumeSessionResult> {
    let session = await this.sessionService.requireSession(sessionId);
    let run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : null;

    if (!run && !isTerminalSessionStatus(session.status)) {
      const pendingInputs = [...session.state.pending_external_inputs];
      run = await this.runService.startRun(session, {
        trigger_type: "resume",
        trigger_ref: null,
        request_id: null,
        external_trigger_id: null
      });

      session.active_run_id = run.run_id;
      session.status = "active";
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

      session.latest_summary_ref = "summary.md";
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session.metadata.summary_needs_refresh = false;
      session = await this.sessionService.saveSession(session);

      await this.refreshDerivedViews();
      return {
        session,
        run,
        checkpoint: refreshed.checkpoint,
        summary: refreshed.summary
      };
    }

    if (!run) {
      run = await this.getLatestRun(session.session_id);
    }

    let checkpoint = run
      ? await this.store.readCheckpoint(session.session_id, run.run_id)
      : null;
    let summary = run
      ? await this.store.readRecoverySummary(session.session_id, run.run_id)
      : await this.store.readSummary(session.session_id);

    if (run && !checkpoint) {
      throw new Error(
        `Recovery checkpoint missing or uncommitted for session ${session.session_id} run ${run.run_id}. Refresh explicitly before resuming.`
      );
    }

    if (run && checkpoint) {
      session = this.checkpointService.applyCheckpoint(session, checkpoint);
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session = await this.sessionService.saveSession(session);
    }

    if (run && checkpoint && !summary) {
      summary = await this.checkpointService.renderSummary(session, run, checkpoint, [
        "Summary regenerated from committed checkpoint."
      ]);
      await this.store.writeCommittedRecoverySummary(session.session_id, run.run_id, summary);
      session.latest_summary_ref = "summary.md";
      session.metadata.summary_needs_refresh = false;
      session = await this.sessionService.saveSession(session);
      await this.eventService.record({
        sessionId: session.session_id,
        runId: run.run_id,
        eventType: "summary_refreshed",
        payload: {
          summary_ref: "summary.md",
          regenerated_from: "checkpoint"
        }
      });
      await this.refreshDerivedViews();
    }

    return { session, run, checkpoint, summary };
  }

  async refreshCheckpoint(sessionId: string): Promise<ResumeSessionResult> {
    let session = await this.sessionService.requireSession(sessionId);
    let run = session.active_run_id
      ? await this.store.readRun(session.session_id, session.active_run_id)
      : await this.getLatestRun(session.session_id);

    if (!run && !isTerminalSessionStatus(session.status)) {
      run = await this.runService.startRun(session, {
        trigger_type: "manual",
        trigger_ref: null,
        request_id: null,
        external_trigger_id: null
      });

      session.active_run_id = run.run_id;
      session.metrics.run_count += 1;
      session.metrics.last_activity_at = run.started_at;
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session = await this.sessionService.saveSession(session);
    }

    if (!run) {
      return {
        session,
        run: null,
        checkpoint: null,
        summary: await this.store.readSummary(session.session_id)
      };
    }

    const refreshed = await this.checkpointService.refreshRecoveryArtifacts(session, run, [
      "Checkpoint refreshed on demand."
    ]);

    session.latest_summary_ref = "summary.md";
    session.latest_checkpoint_ref = checkpointRef(run.run_id);
    session.metadata.summary_needs_refresh = false;
    session = await this.sessionService.saveSession(session);

    await this.refreshDerivedViews();

    return {
      session,
      run,
      checkpoint: refreshed.checkpoint,
      summary: refreshed.summary
    };
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
      run = await this.runService.transitionRun(
        session.session_id,
        run.run_id,
        input.resolution === "abandoned" ? "cancelled" : "completed",
        {
          result_type: input.resolution === "abandoned" ? "no_op" : "completed",
          summary: input.outcome_summary,
          closure_contribution: input.resolution === "abandoned" ? 0 : 1
        }
      );

      if (run.status === "failed" || run.status === "cancelled") {
        session.metrics.failed_run_count += 1;
      }
    }

    session.active_run_id = null;
    session.status = input.resolution === "abandoned" ? "abandoned" : "completed";
    session.lifecycle_stage = "closure";
    session.state.goal_status = input.resolution === "abandoned" ? "abandoned" : "complete";
    session.state.next_machine_actions = [];
    session.state.next_human_actions = [];
    session.metrics.last_activity_at = isoNow();
    session.metadata.summary_needs_refresh = true;
    session = await this.sessionService.saveSession(session);

    if (run) {
      const refreshed = await this.checkpointService.refreshRecoveryArtifacts(session, run, [
        input.outcome_summary
      ]);

      session.latest_summary_ref = "summary.md";
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session.metadata.summary_needs_refresh = false;
      session = await this.sessionService.saveSession(session);

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

    let session = await this.sessionService.requireSession(message.target_session_id);
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

    const pendingInboundCount = Number(session.metadata.pending_inbound_count ?? 0) + 1;
    session.metadata.pending_inbound_count = pendingInboundCount;
    session.state.pending_external_inputs = Array.from(
      new Set([...session.state.pending_external_inputs, message.request_id])
    );
    session.metrics.last_activity_at = message.timestamp;
    session.metadata.summary_needs_refresh = true;
    session = await this.sessionService.saveSession(session);

    let run: Run | null = null;
    let runStarted = false;

    if (canAutoContinueSession(session) && !session.active_run_id) {
      run = await this.runService.startRun(session, {
        trigger_type: "external_message",
        trigger_ref: null,
        request_id: message.request_id,
        external_trigger_id: message.external_trigger_id
      });

      session.active_run_id = run.run_id;
      session.status = "active";
      session.metrics.run_count += 1;
      session.metrics.last_activity_at = run.started_at;
      session.state.pending_external_inputs = session.state.pending_external_inputs.filter(
        (requestId) => requestId !== message.request_id
      );
      session.metadata.pending_inbound_count = Math.max(0, pendingInboundCount - 1);
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session = await this.sessionService.saveSession(session);

      await this.checkpointService.refreshRecoveryArtifacts(session, run, [
        `Inbound message accepted from ${message.source_type}.`
      ]);

      session.latest_summary_ref = "summary.md";
      session.latest_checkpoint_ref = checkpointRef(run.run_id);
      session.metadata.summary_needs_refresh = false;
      session = await this.sessionService.saveSession(session);
      runStarted = true;
    } else {
      if (session.state.pending_human_decisions.length > 0) {
        session.status = "waiting_human";
      } else if (session.state.blockers.length > 0) {
        session.status = "blocked";
      }

      session = await this.sessionService.saveSession(session);
    }

    await this.refreshDerivedViews();

    return {
      message,
      session,
      run,
      run_started: runStarted,
      duplicate: false,
      queued: !runStarted
    };
  }

  async refreshDerivedViews(): Promise<void> {
    const sessions = await this.sessionService.listSessions();
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

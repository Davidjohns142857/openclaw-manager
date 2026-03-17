import { createId } from "../shared/ids.ts";
import {
  readReservedContractState,
  writeReservedContractState,
  type ReservedBlockerSummary,
  type ReservedPendingDecisionSummary
} from "../shared/reserved-contracts.ts";
import { isoNow } from "../shared/time.ts";
import type {
  ClearBlockerInput,
  DetectBlockerInput,
  RequestHumanDecisionInput,
  ResolveHumanDecisionInput
} from "../shared/contracts.ts";
import type { Run, Session } from "../shared/types.ts";
import { EventService } from "./event-service.ts";
import { SessionService } from "./session-service.ts";

export interface ReservedMutationOutcome {
  session: Session;
  applied: boolean;
  errorCode: string | null;
}

export class ReservedContractService {
  sessionService: SessionService;
  eventService: EventService;

  constructor(sessionService: SessionService, eventService: EventService) {
    this.sessionService = sessionService;
    this.eventService = eventService;
  }

  async requestHumanDecision(
    session: Session,
    run: Run | null,
    input: RequestHumanDecisionInput
  ): Promise<ReservedMutationOutcome> {
    const state = readReservedContractState(session);
    const decisionId = input.decision_id ?? createId("dec");

    if (state.pending_human_decisions.some((decision) => decision.decision_id === decisionId)) {
      return {
        session,
        applied: false,
        errorCode: "DECISION_ALREADY_EXISTS"
      };
    }

    const decision: ReservedPendingDecisionSummary = {
      decision_id: decisionId,
      summary: input.summary,
      urgency: input.urgency ?? "medium",
      requested_at: input.requested_at ?? isoNow(),
      requested_by_ref: input.requested_by_ref ?? null,
      metadata: input.metadata ?? {}
    };

    const nextSession = await this.sessionService.saveSession(
      writeReservedContractState(
        {
          ...session,
          metadata: {
            ...session.metadata,
            summary_needs_refresh: true
          }
        },
        {
          ...state,
          pending_human_decisions: [...state.pending_human_decisions, decision]
        }
      )
    );

    await this.eventService.record({
      sessionId: nextSession.session_id,
      runId: run?.run_id ?? null,
      eventType: "human_decision_requested",
      actor: {
        actor_type: "human",
        actor_ref: input.requested_by_ref ?? "host_api"
      },
      payload: {
        decision_id: decision.decision_id,
        summary: decision.summary,
        urgency: decision.urgency
      },
      metadata: input.metadata ?? {}
    });

    return {
      session: nextSession,
      applied: true,
      errorCode: null
    };
  }

  async resolveHumanDecision(
    session: Session,
    run: Run | null,
    decisionId: string,
    input: ResolveHumanDecisionInput
  ): Promise<ReservedMutationOutcome> {
    const state = readReservedContractState(session);
    if (!state.pending_human_decisions.some((decision) => decision.decision_id === decisionId)) {
      return {
        session,
        applied: false,
        errorCode: "DECISION_NOT_FOUND"
      };
    }

    const nextSession = await this.sessionService.saveSession(
      writeReservedContractState(
        {
          ...session,
          metadata: {
            ...session.metadata,
            summary_needs_refresh: true
          }
        },
        {
          ...state,
          pending_human_decisions: state.pending_human_decisions.filter(
            (decision) => decision.decision_id !== decisionId
          )
        }
      )
    );

    await this.eventService.record({
      sessionId: nextSession.session_id,
      runId: run?.run_id ?? null,
      eventType: "human_decision_resolved",
      actor: {
        actor_type: "human",
        actor_ref: input.resolved_by_ref ?? "host_api"
      },
      payload: {
        decision_id: decisionId,
        resolution_summary: input.resolution_summary
      },
      metadata: input.metadata ?? {}
    });

    return {
      session: nextSession,
      applied: true,
      errorCode: null
    };
  }

  async detectBlocker(
    session: Session,
    run: Run | null,
    input: DetectBlockerInput
  ): Promise<ReservedMutationOutcome> {
    const state = readReservedContractState(session);
    const blockerId = input.blocker_id ?? createId("blk");

    if (state.blockers.some((blocker) => blocker.blocker_id === blockerId)) {
      return {
        session,
        applied: false,
        errorCode: "BLOCKER_ALREADY_EXISTS"
      };
    }

    const blocker: ReservedBlockerSummary = {
      blocker_id: blockerId,
      type: input.type,
      summary: input.summary,
      severity: input.severity ?? "medium",
      detected_at: input.detected_at ?? isoNow(),
      detected_by_ref: input.detected_by_ref ?? null,
      metadata: input.metadata ?? {}
    };

    const nextSession = await this.sessionService.saveSession(
      writeReservedContractState(
        {
          ...session,
          metadata: {
            ...session.metadata,
            summary_needs_refresh: true
          }
        },
        {
          ...state,
          blockers: [...state.blockers, blocker]
        }
      )
    );

    await this.eventService.record({
      sessionId: nextSession.session_id,
      runId: run?.run_id ?? null,
      eventType: "blocker_detected",
      actor: {
        actor_type: "agent",
        actor_ref: input.detected_by_ref ?? "host_api"
      },
      payload: {
        blocker_id: blocker.blocker_id,
        type: blocker.type,
        summary: blocker.summary,
        severity: blocker.severity
      },
      metadata: input.metadata ?? {}
    });

    return {
      session: nextSession,
      applied: true,
      errorCode: null
    };
  }

  async clearBlocker(
    session: Session,
    run: Run | null,
    blockerId: string,
    input: ClearBlockerInput
  ): Promise<ReservedMutationOutcome> {
    const state = readReservedContractState(session);
    if (!state.blockers.some((blocker) => blocker.blocker_id === blockerId)) {
      return {
        session,
        applied: false,
        errorCode: "BLOCKER_NOT_FOUND"
      };
    }

    const nextSession = await this.sessionService.saveSession(
      writeReservedContractState(
        {
          ...session,
          metadata: {
            ...session.metadata,
            summary_needs_refresh: true
          }
        },
        {
          ...state,
          blockers: state.blockers.filter((blocker) => blocker.blocker_id !== blockerId)
        }
      )
    );

    await this.eventService.record({
      sessionId: nextSession.session_id,
      runId: run?.run_id ?? null,
      eventType: "blocker_cleared",
      actor: {
        actor_type: "human",
        actor_ref: input.cleared_by_ref ?? "host_api"
      },
      payload: {
        blocker_id: blockerId,
        resolution_summary: input.resolution_summary
      },
      metadata: input.metadata ?? {}
    });

    return {
      session: nextSession,
      applied: true,
      errorCode: null
    };
  }
}

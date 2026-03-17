import { createId } from "../shared/ids.ts";
import { canAdvanceRecoveryHeadForRunStatus, isEndedRunStatus } from "../shared/run-lifecycle.ts";
import { isoNow } from "../shared/time.ts";
import type {
  LocalDistillationSnapshot,
  LocalDistilledFact,
  LocalDistilledMetricName,
  Run,
  RunTriggerType,
  Session
} from "../shared/types.ts";
import { FilesystemStore } from "../storage/fs-store.ts";

interface ScopeAggregate {
  scope_type: "node" | "scenario";
  scope_ref: string;
  sessions: Session[];
  runs: Run[];
}

const recoveryTriggerTypes = new Set<RunTriggerType>(["resume", "retry"]);
const terminalSessionStatuses = new Set<Session["status"]>(["completed", "abandoned"]);

export class LocalDistillationService {
  store: FilesystemStore;

  constructor(store: FilesystemStore) {
    this.store = store;
  }

  async refresh(): Promise<LocalDistillationSnapshot> {
    const snapshot = await this.distill();
    await this.store.writeLocalDistillation(snapshot);
    return snapshot;
  }

  async getSnapshot(): Promise<LocalDistillationSnapshot | null> {
    return this.store.readLocalDistillation();
  }

  async distill(): Promise<LocalDistillationSnapshot> {
    const sessions = (await this.store.listSessions()).filter((session) =>
      terminalSessionStatuses.has(session.status)
    );
    const runsBySession = new Map<string, Run[]>();

    for (const session of sessions) {
      runsBySession.set(session.session_id, await this.store.listRuns(session.session_id));
    }

    const scopes = buildScopes(sessions, runsBySession);
    const generatedAt = isoNow();
    const facts = scopes.flatMap((scope) => buildFactsForScope(scope, generatedAt));

    return {
      contract_id: "local_distillation_v1",
      generated_at: generatedAt,
      source_session_count: sessions.length,
      source_run_count: sessions.reduce(
        (total, session) => total + (runsBySession.get(session.session_id)?.length ?? 0),
        0
      ),
      scenario_count: new Set(scopes.filter((scope) => scope.scope_type === "scenario").map((scope) => scope.scope_ref))
        .size,
      facts
    };
  }
}

function buildScopes(
  sessions: Session[],
  runsBySession: Map<string, Run[]>
): ScopeAggregate[] {
  const scopes: ScopeAggregate[] = [
    {
      scope_type: "node",
      scope_ref: "global",
      sessions,
      runs: sessions.flatMap((session) => runsBySession.get(session.session_id) ?? [])
    }
  ];

  const scenarioMap = new Map<string, ScopeAggregate>();
  for (const session of sessions) {
    const scenarioSignature = session.scenario_signature ?? "general.task_management";
    const existing = scenarioMap.get(scenarioSignature);

    if (existing) {
      existing.sessions.push(session);
      existing.runs.push(...(runsBySession.get(session.session_id) ?? []));
      continue;
    }

    scenarioMap.set(scenarioSignature, {
      scope_type: "scenario",
      scope_ref: scenarioSignature,
      sessions: [session],
      runs: [...(runsBySession.get(session.session_id) ?? [])]
    });
  }

  return [
    ...scopes,
    ...[...scenarioMap.values()].sort((left, right) => left.scope_ref.localeCompare(right.scope_ref))
  ];
}

function buildFactsForScope(scope: ScopeAggregate, computedAt: string): LocalDistilledFact[] {
  const facts: LocalDistilledFact[] = [];
  const closedSessions = scope.sessions;
  const completedSessions = closedSessions.filter((session) => session.status === "completed");

  if (closedSessions.length > 0) {
    facts.push(
      buildFact(scope, "closure_rate", completedSessions.length / closedSessions.length, closedSessions.length, computedAt, {
        numerator: completedSessions.length,
        denominator: closedSessions.length,
        completed_session_count: completedSessions.length,
        abandoned_session_count: closedSessions.length - completedSessions.length
      })
    );
  }

  const endedRuns = scope.runs.filter((run) => isEndedRunStatus(run.status));
  const recoveryRuns = endedRuns.filter((run) => recoveryTriggerTypes.has(run.trigger.trigger_type));
  const successfulRecoveryRuns = recoveryRuns.filter((run) =>
    canAdvanceRecoveryHeadForRunStatus(run.status)
  );
  if (recoveryRuns.length > 0) {
    facts.push(
      buildFact(
        scope,
        "recovery_success_rate",
        successfulRecoveryRuns.length / recoveryRuns.length,
        recoveryRuns.length,
        computedAt,
        {
          numerator: successfulRecoveryRuns.length,
          denominator: recoveryRuns.length,
          successful_recovery_run_count: successfulRecoveryRuns.length,
          recovery_run_count: recoveryRuns.length
        }
      )
    );
  }

  const humanInterventionRuns = endedRuns.filter(
    (run) => run.outcome.human_takeover || run.status === "waiting_human"
  );
  if (endedRuns.length > 0) {
    facts.push(
      buildFact(
        scope,
        "human_intervention_rate",
        humanInterventionRuns.length / endedRuns.length,
        endedRuns.length,
        computedAt,
        {
          numerator: humanInterventionRuns.length,
          denominator: endedRuns.length,
          human_takeover_run_count: humanInterventionRuns.length,
          ended_run_count: endedRuns.length
        }
      )
    );
  }

  const blockedRunCountBySession = new Map<string, number>();
  for (const run of scope.runs) {
    if (run.status !== "blocked") {
      continue;
    }

    blockedRunCountBySession.set(
      run.session_id,
      (blockedRunCountBySession.get(run.session_id) ?? 0) + 1
    );
  }
  const blockedSessions = [...blockedRunCountBySession.values()].filter((count) => count >= 1);
  const recurrentBlockedSessions = blockedSessions.filter((count) => count >= 2);
  if (blockedSessions.length > 0) {
    facts.push(
      buildFact(
        scope,
        "blocked_recurrence_rate",
        recurrentBlockedSessions.length / blockedSessions.length,
        blockedSessions.length,
        computedAt,
        {
          numerator: recurrentBlockedSessions.length,
          denominator: blockedSessions.length,
          recurrent_blocked_session_count: recurrentBlockedSessions.length,
          blocked_session_count: blockedSessions.length
        }
      )
    );
  }

  const totalRuns = scope.runs.length;
  if (totalRuns > 0) {
    const triggerCounts = new Map<RunTriggerType, number>();
    for (const run of scope.runs) {
      triggerCounts.set(run.trigger.trigger_type, (triggerCounts.get(run.trigger.trigger_type) ?? 0) + 1);
    }

    for (const triggerType of [...triggerCounts.keys()].sort()) {
      const count = triggerCounts.get(triggerType) ?? 0;
      facts.push(
        buildFact(scope, "run_trigger_rate", count / totalRuns, totalRuns, computedAt, {
          trigger_type: triggerType,
          count,
          total_run_count: totalRuns
        })
      );
    }
  }

  return facts.sort(compareFacts);
}

function buildFact(
  scope: ScopeAggregate,
  metricName: LocalDistilledMetricName,
  metricValue: number,
  sampleSize: number,
  computedAt: string,
  metadata: Record<string, unknown>
): LocalDistilledFact {
  return {
    fact_id: createId("lfact"),
    scope_type: scope.scope_type,
    scope_ref: scope.scope_ref,
    metric_name: metricName,
    metric_value: round(metricValue),
    sample_size: sampleSize,
    confidence: confidenceFromSampleSize(sampleSize),
    metadata,
    computed_at: computedAt
  };
}

function confidenceFromSampleSize(sampleSize: number): number {
  return round(Math.min(0.99, Math.max(0, 1 - 1 / Math.sqrt(sampleSize))));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function compareFacts(left: LocalDistilledFact, right: LocalDistilledFact): number {
  return (
    left.scope_type.localeCompare(right.scope_type) ||
    left.scope_ref.localeCompare(right.scope_ref) ||
    left.metric_name.localeCompare(right.metric_name) ||
    String(left.metadata.trigger_type ?? "").localeCompare(String(right.metadata.trigger_type ?? ""))
  );
}

import { createStableId } from "../shared/ids.ts";
import { canAdvanceRecoveryHeadForRunStatus, isEndedRunStatus } from "../shared/run-lifecycle.ts";
import type {
  CapabilityFact,
  CapabilityFactAggregationWindow,
  LocalDistillationSnapshot,
  LocalDistilledMetricName,
  Run,
  RunTriggerType,
  Session,
  SkillTrace
} from "../shared/types.ts";
import { FilesystemStore } from "../storage/fs-store.ts";

interface DistillationScope {
  subject_type: "node" | "scenario" | "skill" | "workflow";
  subject_ref: string;
  subject_version: string | null;
  scenario_signature: string;
  sessions: Session[];
  runs: Run[];
  traces: SkillTrace[];
  metadata: Record<string, unknown>;
}

interface ScopeAccumulator {
  scope: DistillationScope;
  session_ids: Set<string>;
  run_ids: Set<string>;
  trace_ids: Set<string>;
}

const DEFAULT_SCENARIO_SIGNATURE = "general.task_management";
const ALL_SCENARIOS_SIGNATURE = "all_scenarios";
const GLOBAL_SCOPE_REF = "global";
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
    const tracesByRunKey = new Map<string, SkillTrace[]>();

    for (const session of sessions) {
      const runs = await this.store.listRuns(session.session_id);
      runsBySession.set(session.session_id, runs);

      for (const run of runs) {
        tracesByRunKey.set(
          buildRunKey(session.session_id, run.run_id),
          await this.store.readSkillTraces(session.session_id, run.run_id)
        );
      }
    }

    const scopes = [
      ...buildSystemScopes(sessions, runsBySession, tracesByRunKey),
      ...buildSkillScopes(sessions, runsBySession, tracesByRunKey),
      ...buildWorkflowScopes(sessions, runsBySession, tracesByRunKey)
    ];
    const facts = scopes.flatMap((scope) => buildFactsForScope(scope));
    const windowEndAt =
      maxIso([
        ...sessions.flatMap((session) => [
          session.created_at,
          session.updated_at,
          session.metrics.last_activity_at
        ]),
        ...sessions.flatMap((session) =>
          (runsBySession.get(session.session_id) ?? []).flatMap((run) => [run.started_at, run.ended_at])
        ),
        ...[...tracesByRunKey.values()].flat().map((trace) => trace.created_at)
      ]) ?? "1970-01-01T00:00:00.000Z";

    return {
      contract_id: "local_distillation_v1",
      generated_at: windowEndAt,
      source_session_count: sessions.length,
      source_run_count: sessions.reduce(
        (total, session) => total + (runsBySession.get(session.session_id)?.length ?? 0),
        0
      ),
      scenario_count: new Set(
        scopes.filter((scope) => scope.subject_type === "scenario").map((scope) => scope.subject_ref)
      ).size,
      facts
    };
  }
}

function buildSystemScopes(
  sessions: Session[],
  runsBySession: Map<string, Run[]>,
  tracesByRunKey: Map<string, SkillTrace[]>
): DistillationScope[] {
  const global = createScopeAccumulator({
    subject_type: "node",
    subject_ref: GLOBAL_SCOPE_REF,
    subject_version: null,
    scenario_signature: ALL_SCENARIOS_SIGNATURE,
    metadata: {}
  });
  const scenarioScopes = new Map<string, ScopeAccumulator>();

  for (const session of sessions) {
    const scenarioSignature = scenarioOf(session);
    const sessionRuns = runsBySession.get(session.session_id) ?? [];

    addSession(global, session);
    for (const run of sessionRuns) {
      addRun(global, run);
      for (const trace of tracesByRunKey.get(buildRunKey(session.session_id, run.run_id)) ?? []) {
        addTrace(global, trace);
      }
    }

    const scenarioScope = getOrCreateScope(
      scenarioScopes,
      {
        subject_type: "scenario",
        subject_ref: scenarioSignature,
        subject_version: null,
        scenario_signature: scenarioSignature,
        metadata: {}
      },
      `${scenarioSignature}`
    );
    addSession(scenarioScope, session);
    for (const run of sessionRuns) {
      addRun(scenarioScope, run);
      for (const trace of tracesByRunKey.get(buildRunKey(session.session_id, run.run_id)) ?? []) {
        addTrace(scenarioScope, trace);
      }
    }
  }

  return finalizeScopes([global, ...scenarioScopes.values()]);
}

function buildSkillScopes(
  sessions: Session[],
  runsBySession: Map<string, Run[]>,
  tracesByRunKey: Map<string, SkillTrace[]>
): DistillationScope[] {
  const scopes = new Map<string, ScopeAccumulator>();
  const runLookup = buildRunLookup(runsBySession);

  for (const session of sessions) {
    const scenarioSignature = scenarioOf(session);
    const sessionRuns = runsBySession.get(session.session_id) ?? [];

    for (const run of sessionRuns) {
      const traces = tracesByRunKey.get(buildRunKey(session.session_id, run.run_id)) ?? [];

      for (const trace of traces) {
        const referencedRun = runLookup.get(buildRunKey(trace.session_id, trace.run_id));
        if (!referencedRun) {
          continue;
        }

        for (const nextScope of [
          {
            scenario_signature: ALL_SCENARIOS_SIGNATURE,
            subject_ref: trace.skill_name,
            subject_version: trace.skill_version ?? null
          },
          {
            scenario_signature: scenarioSignature,
            subject_ref: trace.skill_name,
            subject_version: trace.skill_version ?? null
          }
        ]) {
          const key = [
            nextScope.scenario_signature,
            nextScope.subject_ref,
            nextScope.subject_version ?? "null"
          ].join("::");
          const scope = getOrCreateScope(
            scopes,
            {
              subject_type: "skill",
              subject_ref: nextScope.subject_ref,
              subject_version: nextScope.subject_version,
              scenario_signature: nextScope.scenario_signature,
              metadata: {}
            },
            key
          );
          addSession(scope, session);
          addRun(scope, referencedRun);
          addTrace(scope, trace);
        }
      }
    }
  }

  return finalizeScopes(scopes.values());
}

function buildWorkflowScopes(
  sessions: Session[],
  runsBySession: Map<string, Run[]>,
  tracesByRunKey: Map<string, SkillTrace[]>
): DistillationScope[] {
  const scopes = new Map<string, ScopeAccumulator>();

  for (const session of sessions) {
    const scenarioSignature = scenarioOf(session);
    const sessionRuns = runsBySession.get(session.session_id) ?? [];
    const sessionTraces = sessionRuns.flatMap(
      (run) => tracesByRunKey.get(buildRunKey(session.session_id, run.run_id)) ?? []
    );
    const workflowSkills = new Set<string>();

    for (const run of sessionRuns) {
      for (const skillName of run.execution.invoked_skills) {
        workflowSkills.add(skillName);
      }
    }
    for (const trace of sessionTraces) {
      workflowSkills.add(trace.skill_name);
    }

    const skillNames = [...workflowSkills].sort((left, right) => left.localeCompare(right));
    if (skillNames.length === 0) {
      continue;
    }

    const workflowRef = buildWorkflowRef(skillNames);
    const metadata = {
      skill_names: skillNames,
      skill_count: skillNames.length
    };

    for (const nextScope of [
      {
        scenario_signature: ALL_SCENARIOS_SIGNATURE,
        subject_ref: workflowRef
      },
      {
        scenario_signature: scenarioSignature,
        subject_ref: workflowRef
      }
    ]) {
      const key = `${nextScope.scenario_signature}::${nextScope.subject_ref}`;
      const scope = getOrCreateScope(
        scopes,
        {
          subject_type: "workflow",
          subject_ref: nextScope.subject_ref,
          subject_version: null,
          scenario_signature: nextScope.scenario_signature,
          metadata
        },
        key
      );
      addSession(scope, session);
      for (const run of sessionRuns) {
        addRun(scope, run);
      }
      for (const trace of sessionTraces) {
        addTrace(scope, trace);
      }
    }
  }

  return finalizeScopes(scopes.values());
}

function buildFactsForScope(scope: DistillationScope): CapabilityFact[] {
  switch (scope.subject_type) {
    case "node":
    case "scenario":
      return buildSystemFactsForScope(scope);
    case "skill":
      return buildSkillFactsForScope(scope);
    case "workflow":
      return buildWorkflowFactsForScope(scope);
  }

  return [];
}

function buildSystemFactsForScope(scope: DistillationScope): CapabilityFact[] {
  const facts: CapabilityFact[] = [];
  const closedSessions = scope.sessions;
  const completedSessions = closedSessions.filter((session) => session.status === "completed");
  const aggregationWindow = buildAggregationWindow(scope);
  const computedAt = aggregationWindow.end_at;

  if (closedSessions.length > 0) {
    facts.push(
      buildFact(
        scope,
        aggregationWindow,
        "closure_rate",
        completedSessions.length / closedSessions.length,
        closedSessions.length,
        computedAt,
        {
          numerator: completedSessions.length,
          denominator: closedSessions.length,
          completed_session_count: completedSessions.length,
          abandoned_session_count: closedSessions.length - completedSessions.length
        }
      )
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
        aggregationWindow,
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
        aggregationWindow,
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
        aggregationWindow,
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
      triggerCounts.set(
        run.trigger.trigger_type,
        (triggerCounts.get(run.trigger.trigger_type) ?? 0) + 1
      );
    }

    for (const triggerType of [...triggerCounts.keys()].sort()) {
      const count = triggerCounts.get(triggerType) ?? 0;
      facts.push(
        buildFact(scope, aggregationWindow, "run_trigger_rate", count / totalRuns, totalRuns, computedAt, {
          trigger_type: triggerType,
          count,
          total_run_count: totalRuns
        })
      );
    }
  }

  return facts.sort(compareFacts);
}

function buildSkillFactsForScope(scope: DistillationScope): CapabilityFact[] {
  if (scope.traces.length === 0 || scope.sessions.length === 0) {
    return [];
  }

  const facts: CapabilityFact[] = [];
  const aggregationWindow = buildAggregationWindow(scope);
  const computedAt = aggregationWindow.end_at;
  const completedSessions = scope.sessions.filter((session) => session.status === "completed");
  const traceCount = scope.traces.length;
  const runLookup = new Map(
    scope.runs.map((run) => [buildRunKey(run.session_id, run.run_id), run] as const)
  );
  const successfulTraces = scope.traces.filter((trace) => trace.success);
  const failedTraces = scope.traces.filter((trace) => !trace.success);
  const humanFixTraces = scope.traces.filter((trace) => trace.requires_human_fix);
  const primaryTraces = scope.traces.filter((trace) => trace.contribution_type === "primary");
  const regressiveTraces = scope.traces.filter((trace) => trace.contribution_type === "regressive");
  const blockedTraces = scope.traces.filter(
    (trace) => runLookup.get(buildRunKey(trace.session_id, trace.run_id))?.status === "blocked"
  );

  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "closure_rate",
      completedSessions.length / scope.sessions.length,
      scope.sessions.length,
      computedAt,
      {
        numerator: completedSessions.length,
        denominator: scope.sessions.length,
        completed_session_count: completedSessions.length,
        terminal_session_count: scope.sessions.length
      }
    )
  );
  facts.push(
    buildFact(scope, aggregationWindow, "invocation_count", traceCount, traceCount, computedAt, {
      invocation_count: traceCount
    })
  );
  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "success_rate",
      successfulTraces.length / traceCount,
      traceCount,
      computedAt,
      {
        numerator: successfulTraces.length,
        denominator: traceCount,
        successful_trace_count: successfulTraces.length
      }
    )
  );
  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "failure_rate",
      failedTraces.length / traceCount,
      traceCount,
      computedAt,
      {
        numerator: failedTraces.length,
        denominator: traceCount,
        failed_trace_count: failedTraces.length
      }
    )
  );
  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "human_intervention_rate",
      humanFixTraces.length / traceCount,
      traceCount,
      computedAt,
      {
        numerator: humanFixTraces.length,
        denominator: traceCount,
        human_fix_trace_count: humanFixTraces.length
      }
    )
  );
  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "avg_duration_ms",
      average(scope.traces.map((trace) => trace.duration_ms)),
      traceCount,
      computedAt,
      {
        total_duration_ms: round(scope.traces.reduce((total, trace) => total + trace.duration_ms, 0))
      }
    )
  );
  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "avg_closure_contribution",
      average(scope.traces.map((trace) => trace.closure_contribution_score)),
      traceCount,
      computedAt,
      {
        total_closure_contribution: round(
          scope.traces.reduce((total, trace) => total + trace.closure_contribution_score, 0)
        )
      }
    )
  );
  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "primary_contribution_rate",
      primaryTraces.length / traceCount,
      traceCount,
      computedAt,
      {
        numerator: primaryTraces.length,
        denominator: traceCount,
        primary_trace_count: primaryTraces.length
      }
    )
  );
  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "regressive_rate",
      regressiveTraces.length / traceCount,
      traceCount,
      computedAt,
      {
        numerator: regressiveTraces.length,
        denominator: traceCount,
        regressive_trace_count: regressiveTraces.length
      }
    )
  );
  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "blocker_trigger_rate",
      blockedTraces.length / traceCount,
      traceCount,
      computedAt,
      {
        numerator: blockedTraces.length,
        denominator: traceCount,
        blocked_trace_count: blockedTraces.length
      }
    )
  );

  return facts.sort(compareFacts);
}

function buildWorkflowFactsForScope(scope: DistillationScope): CapabilityFact[] {
  if (scope.sessions.length === 0) {
    return [];
  }

  const facts: CapabilityFact[] = [];
  const aggregationWindow = buildAggregationWindow(scope);
  const computedAt = aggregationWindow.end_at;
  const completedSessions = scope.sessions.filter((session) => session.status === "completed");
  const completedSessionIds = new Set(completedSessions.map((session) => session.session_id));
  const completedRunCount = scope.runs.filter((run) => completedSessionIds.has(run.session_id)).length;

  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "workflow_closure_rate",
      completedSessions.length / scope.sessions.length,
      scope.sessions.length,
      computedAt,
      {
        ...scope.metadata,
        numerator: completedSessions.length,
        denominator: scope.sessions.length,
        completed_session_count: completedSessions.length,
        terminal_session_count: scope.sessions.length
      }
    )
  );
  facts.push(
    buildFact(
      scope,
      aggregationWindow,
      "workflow_efficiency",
      completedRunCount === 0 ? 0 : completedSessions.length / completedRunCount,
      scope.sessions.length,
      computedAt,
      {
        ...scope.metadata,
        completed_session_count: completedSessions.length,
        completed_run_count: completedRunCount
      }
    )
  );

  return facts.sort(compareFacts);
}

function buildFact(
  scope: DistillationScope,
  aggregationWindow: CapabilityFactAggregationWindow,
  metricName: LocalDistilledMetricName,
  metricValue: number,
  sampleSize: number,
  computedAt: string,
  metadata: Record<string, unknown>
): CapabilityFact {
  const metricValueRounded = round(metricValue);
  const factId = createStableId("fact", {
    subject_type: scope.subject_type,
    subject_ref: scope.subject_ref,
    subject_version: scope.subject_version,
    scenario_signature: scope.scenario_signature,
    metric_name: metricName,
    metric_value: metricValueRounded,
    sample_size: sampleSize,
    metadata
  });

  return {
    fact_id: factId,
    fact_kind: "aggregate_metric",
    subject: {
      subject_type: scope.subject_type,
      subject_ref: scope.subject_ref,
      subject_version: scope.subject_version
    },
    scenario_signature: scope.scenario_signature,
    metric_name: metricName,
    metric_value: metricValueRounded,
    sample_size: sampleSize,
    confidence: confidenceFromSampleSize(sampleSize),
    aggregation_window: aggregationWindow,
    privacy: {
      privacy_tier: "aggregated_export_safe",
      export_policy: "public_submit_allowed",
      contains_identifiers: false,
      contains_content: false,
      declaration:
        "Aggregated from durable terminal sessions, runs, and skill traces; export-safe and does not contain raw task content."
    },
    evidence_refs: [],
    metadata,
    computed_at: computedAt
  };
}

function buildAggregationWindow(scope: DistillationScope): CapabilityFactAggregationWindow {
  const sessionTimes = scope.sessions.flatMap((session) => [
    session.created_at,
    session.updated_at,
    session.metrics.last_activity_at
  ]);
  const runTimes = scope.runs.flatMap((run) => [run.started_at, run.ended_at]);
  const traceTimes = scope.traces.map((trace) => trace.created_at);
  const allTimes = [...sessionTimes, ...runTimes, ...traceTimes].filter(
    (value): value is string => typeof value === "string"
  );
  const startAt = minIso(allTimes);
  const endAt = maxIso(allTimes) ?? "1970-01-01T00:00:00.000Z";

  return {
    window_type: "closed_session_history",
    start_at: startAt,
    end_at: endAt
  };
}

function createScopeAccumulator(input: {
  subject_type: DistillationScope["subject_type"];
  subject_ref: string;
  subject_version: string | null;
  scenario_signature: string;
  metadata: Record<string, unknown>;
}): ScopeAccumulator {
  return {
    scope: {
      subject_type: input.subject_type,
      subject_ref: input.subject_ref,
      subject_version: input.subject_version,
      scenario_signature: input.scenario_signature,
      sessions: [],
      runs: [],
      traces: [],
      metadata: input.metadata
    },
    session_ids: new Set<string>(),
    run_ids: new Set<string>(),
    trace_ids: new Set<string>()
  };
}

function getOrCreateScope(
  scopes: Map<string, ScopeAccumulator>,
  input: {
    subject_type: DistillationScope["subject_type"];
    subject_ref: string;
    subject_version: string | null;
    scenario_signature: string;
    metadata: Record<string, unknown>;
  },
  key: string
): ScopeAccumulator {
  const existing = scopes.get(key);
  if (existing) {
    return existing;
  }

  const next = createScopeAccumulator(input);
  scopes.set(key, next);
  return next;
}

function addSession(scope: ScopeAccumulator, session: Session): void {
  if (scope.session_ids.has(session.session_id)) {
    return;
  }

  scope.session_ids.add(session.session_id);
  scope.scope.sessions.push(session);
}

function addRun(scope: ScopeAccumulator, run: Run): void {
  const key = buildRunKey(run.session_id, run.run_id);
  if (scope.run_ids.has(key)) {
    return;
  }

  scope.run_ids.add(key);
  scope.scope.runs.push(run);
}

function addTrace(scope: ScopeAccumulator, trace: SkillTrace): void {
  if (scope.trace_ids.has(trace.trace_id)) {
    return;
  }

  scope.trace_ids.add(trace.trace_id);
  scope.scope.traces.push(trace);
}

function finalizeScopes(scopes: Iterable<ScopeAccumulator>): DistillationScope[] {
  return [...scopes]
    .map(({ scope }) => ({
      ...scope,
      sessions: [...scope.sessions].sort(compareSessions),
      runs: [...scope.runs].sort(compareRuns),
      traces: [...scope.traces].sort(compareTraces)
    }))
    .sort(compareScopes);
}

function buildRunLookup(runsBySession: Map<string, Run[]>): Map<string, Run> {
  const lookup = new Map<string, Run>();
  for (const [sessionId, runs] of runsBySession.entries()) {
    for (const run of runs) {
      lookup.set(buildRunKey(sessionId, run.run_id), run);
    }
  }
  return lookup;
}

function buildWorkflowRef(skillNames: string[]): string {
  return skillNames.join("|");
}

function buildRunKey(sessionId: string, runId: string): string {
  return `${sessionId}::${runId}`;
}

function scenarioOf(session: Session): string {
  return session.scenario_signature ?? DEFAULT_SCENARIO_SIGNATURE;
}

function confidenceFromSampleSize(sampleSize: number): number {
  return round(Math.min(0.99, Math.max(0, 1 - 1 / Math.sqrt(sampleSize))));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return round(values.reduce((total, value) => total + value, 0) / values.length);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function minIso(values: string[]): string | null {
  const filtered = values.filter(Boolean).sort();
  return filtered[0] ?? null;
}

function maxIso(values: Array<string | null>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value)).sort();
  return filtered.at(-1) ?? null;
}

function compareFacts(left: CapabilityFact, right: CapabilityFact): number {
  return (
    left.subject.subject_type.localeCompare(right.subject.subject_type) ||
    left.subject.subject_ref.localeCompare(right.subject.subject_ref) ||
    String(left.subject.subject_version ?? "").localeCompare(String(right.subject.subject_version ?? "")) ||
    left.scenario_signature.localeCompare(right.scenario_signature) ||
    left.metric_name.localeCompare(right.metric_name) ||
    String(left.metadata.trigger_type ?? "").localeCompare(String(right.metadata.trigger_type ?? ""))
  );
}

function compareScopes(left: DistillationScope, right: DistillationScope): number {
  return (
    left.subject_type.localeCompare(right.subject_type) ||
    left.subject_ref.localeCompare(right.subject_ref) ||
    String(left.subject_version ?? "").localeCompare(String(right.subject_version ?? "")) ||
    left.scenario_signature.localeCompare(right.scenario_signature)
  );
}

function compareSessions(left: Session, right: Session): number {
  return left.session_id.localeCompare(right.session_id);
}

function compareRuns(left: Run, right: Run): number {
  return (
    left.started_at.localeCompare(right.started_at) ||
    left.run_id.localeCompare(right.run_id)
  );
}

function compareTraces(left: SkillTrace, right: SkillTrace): number {
  return (
    left.created_at.localeCompare(right.created_at) ||
    left.trace_id.localeCompare(right.trace_id)
  );
}

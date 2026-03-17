import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { executeManagerCommand } from "../src/skill/commands.ts";
import { ManagerServer } from "../src/api/server.ts";
import type {
  LocalDistillationSnapshot,
  CapabilityFact
} from "../src/shared/types.ts";
import { createTempManager, dispatchRoute, pathExists, readJson } from "./helpers.ts";

function findFact(
  snapshot: LocalDistillationSnapshot,
  input: {
    subjectType: CapabilityFact["subject"]["subject_type"];
    subjectRef: string;
    metricName: CapabilityFact["metric_name"];
    triggerType?: string;
  }
): CapabilityFact {
  const fact = snapshot.facts.find((candidate) => {
    if (
      candidate.subject.subject_type !== input.subjectType ||
      candidate.subject.subject_ref !== input.subjectRef ||
      candidate.metric_name !== input.metricName
    ) {
      return false;
    }

    if (input.triggerType !== undefined) {
      return candidate.metadata.trigger_type === input.triggerType;
    }

    return true;
  });

  assert.ok(
    fact,
    `Missing fact ${input.subjectType}:${input.subjectRef}:${input.metricName}:${input.triggerType ?? "*"}`
  );
  return fact;
}

async function startRetryRun(
  manager: Awaited<ReturnType<typeof createTempManager>>,
  sessionId: string,
  triggerRef: string
): Promise<void> {
  let session = await manager.controlPlane.sessionService.requireSession(sessionId);
  session.status = "active";
  session.state.blockers = [];
  session.state.pending_human_decisions = [];

  const run = await manager.controlPlane.runService.startRun(
    session,
    {
      trigger_type: "retry",
      trigger_ref: triggerRef,
      request_id: null,
      external_trigger_id: null
    },
    {
      startCheckpointRef: session.latest_checkpoint_ref
    }
  );

  session.active_run_id = run.run_id;
  session.metrics.run_count += 1;
  session.metrics.last_activity_at = run.started_at;
  session.latest_checkpoint_ref = `runs/${run.run_id}/checkpoint.json`;
  session.metadata.summary_needs_refresh = true;
  await manager.controlPlane.sessionService.saveSession(session);
}

test("local distillation refreshes from durable terminal sessions and exposes node/scenario metrics", async () => {
  const manager = await createTempManager();

  try {
    const alphaCompleted = await manager.controlPlane.adoptSession({
      title: "Alpha complete",
      objective: "Contribute one completed manual run.",
      scenario_signature: "scenario.alpha"
    });
    await manager.controlPlane.settleActiveRun(alphaCompleted.session.session_id, {
      status: "completed",
      summary: "Alpha completed cleanly.",
      reason_code: "alpha_done"
    });
    await manager.controlPlane.closeSession(alphaCompleted.session.session_id, {
      outcome_summary: "Alpha session closed as complete."
    });

    const alphaBlocked = await manager.controlPlane.adoptSession({
      title: "Alpha blocked twice",
      objective: "Contribute blocked recurrence and retry trigger distribution.",
      scenario_signature: "scenario.alpha"
    });
    const firstBlocked = await manager.controlPlane.settleActiveRun(alphaBlocked.session.session_id, {
      status: "blocked",
      summary: "First upstream dependency blocked progress.",
      reason_code: "external_dependency",
      blockers: [
        {
          blocker_id: "blk_alpha_001",
          type: "external_dependency",
          summary: "Waiting on upstream.",
          detected_at: "2026-03-17T00:00:00.000Z",
          severity: "high"
        }
      ]
    });
    await startRetryRun(manager, alphaBlocked.session.session_id, firstBlocked.run.run_id);
    await manager.controlPlane.settleActiveRun(alphaBlocked.session.session_id, {
      status: "blocked",
      summary: "Second upstream dependency blocked retry.",
      reason_code: "external_dependency",
      blockers: [
        {
          blocker_id: "blk_alpha_002",
          type: "external_dependency",
          summary: "Still waiting on upstream.",
          detected_at: "2026-03-17T00:10:00.000Z",
          severity: "high"
        }
      ]
    });
    await manager.controlPlane.closeSession(alphaBlocked.session.session_id, {
      outcome_summary: "Alpha blocked session abandoned after repeated stalls.",
      resolution: "abandoned"
    });

    const betaRecovered = await manager.controlPlane.adoptSession({
      title: "Beta recoverable failure",
      objective: "Contribute resume-based recovery success.",
      scenario_signature: "scenario.beta"
    });
    await manager.controlPlane.settleActiveRun(betaRecovered.session.session_id, {
      status: "failed",
      summary: "First beta attempt failed.",
      reason_code: "transient_error"
    });
    const resumed = await manager.controlPlane.resumeSession(betaRecovered.session.session_id);
    assert.ok(resumed.run);
    assert.equal(resumed.run?.trigger.trigger_type, "resume");
    await manager.controlPlane.settleActiveRun(betaRecovered.session.session_id, {
      status: "completed",
      summary: "Beta resumed and completed.",
      reason_code: "recovered"
    });
    await manager.controlPlane.closeSession(betaRecovered.session.session_id, {
      outcome_summary: "Beta session closed after successful recovery."
    });

    const betaWaitingHuman = await manager.controlPlane.adoptSession({
      title: "Beta waiting human",
      objective: "Contribute human intervention rate.",
      scenario_signature: "scenario.beta"
    });
    await manager.controlPlane.settleActiveRun(betaWaitingHuman.session.session_id, {
      status: "waiting_human",
      summary: "Need a human decision before final delivery.",
      reason_code: "approval_required",
      pending_human_decisions: [
        {
          decision_id: "dec_beta_001",
          summary: "Approve the final answer.",
          requested_at: "2026-03-17T00:20:00.000Z",
          urgency: "high"
        }
      ]
    });
    await manager.controlPlane.closeSession(betaWaitingHuman.session.session_id, {
      outcome_summary: "Human decided externally and session was closed as complete."
    });

    const snapshot = await manager.controlPlane.getLocalDistillation();
    assert.ok(snapshot);
    assert.equal(snapshot.contract_id, "local_distillation_v1");
    assert.equal(snapshot.source_session_count, 4);
    assert.equal(snapshot.source_run_count, 6);
    assert.equal(snapshot.scenario_count, 2);

    const globalClosure = findFact(snapshot, {
      subjectType: "node",
      subjectRef: "global",
      metricName: "closure_rate"
    });
    assert.equal(globalClosure.metric_value, 0.75);
    assert.equal(globalClosure.sample_size, 4);
    assert.equal(globalClosure.fact_kind, "aggregate_metric");
    assert.equal(globalClosure.scenario_signature, "all_scenarios");
    assert.equal(globalClosure.privacy.export_policy, "public_submit_allowed");
    assert.equal(globalClosure.aggregation_window.window_type, "closed_session_history");

    const globalRecovery = findFact(snapshot, {
      subjectType: "node",
      subjectRef: "global",
      metricName: "recovery_success_rate"
    });
    assert.equal(globalRecovery.metric_value, 1);
    assert.equal(globalRecovery.sample_size, 2);

    const globalHumanIntervention = findFact(snapshot, {
      subjectType: "node",
      subjectRef: "global",
      metricName: "human_intervention_rate"
    });
    assert.equal(globalHumanIntervention.metric_value, 0.1667);
    assert.equal(globalHumanIntervention.sample_size, 6);

    const globalBlockedRecurrence = findFact(snapshot, {
      subjectType: "node",
      subjectRef: "global",
      metricName: "blocked_recurrence_rate"
    });
    assert.equal(globalBlockedRecurrence.metric_value, 1);
    assert.equal(globalBlockedRecurrence.sample_size, 1);

    const manualTrigger = findFact(snapshot, {
      subjectType: "node",
      subjectRef: "global",
      metricName: "run_trigger_rate",
      triggerType: "manual"
    });
    assert.equal(manualTrigger.metric_value, 0.6667);
    assert.equal(manualTrigger.metadata.count, 4);

    const resumeTrigger = findFact(snapshot, {
      subjectType: "node",
      subjectRef: "global",
      metricName: "run_trigger_rate",
      triggerType: "resume"
    });
    assert.equal(resumeTrigger.metric_value, 0.1667);
    assert.equal(resumeTrigger.metadata.count, 1);

    const retryTrigger = findFact(snapshot, {
      subjectType: "node",
      subjectRef: "global",
      metricName: "run_trigger_rate",
      triggerType: "retry"
    });
    assert.equal(retryTrigger.metric_value, 0.1667);
    assert.equal(retryTrigger.metadata.count, 1);

    const alphaClosure = findFact(snapshot, {
      subjectType: "scenario",
      subjectRef: "scenario.alpha",
      metricName: "closure_rate"
    });
    assert.equal(alphaClosure.metric_value, 0.5);
    assert.equal(alphaClosure.sample_size, 2);

    const betaRecovery = findFact(snapshot, {
      subjectType: "scenario",
      subjectRef: "scenario.beta",
      metricName: "recovery_success_rate"
    });
    assert.equal(betaRecovery.metric_value, 1);
    assert.equal(betaRecovery.sample_size, 1);

    const storedSnapshot = await readJson<LocalDistillationSnapshot>(
      path.join(manager.tempRoot, "indexes", "local_distillation.json")
    );
    assert.equal(storedSnapshot.contract_id, snapshot.contract_id);
    assert.equal(storedSnapshot.source_session_count, 4);
  } finally {
    await manager.cleanup();
  }
});

test("distillation routes and command surface stay local-only and do not create public-ingest side effects", async () => {
  const manager = await createTempManager();
  const server = new ManagerServer(manager.controlPlane, manager.config);

  try {
    const initial = await dispatchRoute(server, "GET", "/distillation/local");
    assert.equal(initial.statusCode, 200);
    assert.equal(
      (initial.body as { contract_id: string; source_session_count: number }).contract_id,
      "local_distillation_v1"
    );
    assert.equal(
      (initial.body as { contract_id: string; source_session_count: number }).source_session_count,
      0
    );

    const adopted = await manager.controlPlane.adoptSession({
      title: "Local distillation route flow",
      objective: "Verify local distillation stays local-only."
    });
    await manager.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "completed",
      summary: "Route flow completed.",
      reason_code: "route_done"
    });
    await dispatchRoute(server, "POST", `/sessions/${adopted.session.session_id}/close`, {
      outcome_summary: "Route flow closed."
    });

    const routeResponse = await dispatchRoute(server, "GET", "/distillation/local");
    assert.equal(routeResponse.statusCode, 200);
    assert.equal(
      (routeResponse.body as { contract_id: string; source_session_count: number }).contract_id,
      "local_distillation_v1"
    );
    assert.equal(
      (routeResponse.body as { contract_id: string; source_session_count: number })
        .source_session_count,
      1
    );

    const recomputed = await dispatchRoute(server, "POST", "/distill");
    assert.equal(recomputed.statusCode, 200);
    assert.equal(
      (recomputed.body as { contract_id: string; source_session_count: number }).source_session_count,
      1
    );

    const commandResult = await executeManagerCommand(
      {
        listSessions: () => manager.controlPlane.listTasks(),
        focus: () => manager.controlPlane.focus(),
        digest: async () => ({ digest: await manager.controlPlane.digest() }),
        distill: () => manager.controlPlane.distillLocalFacts(),
        submitPublicFacts: () =>
          Promise.resolve({
            contract_id: "submit_public_facts_v1",
            mode: "dry-run",
            dry_run: true,
            selected_fact_count: 0,
            created_batch_count: 0,
            submitted_batch_count: 0,
            batches: []
          }),
        adopt: (input) => manager.controlPlane.adoptSession(input),
        bind: (input) => manager.controlPlane.bindSource(input),
        disableBinding: (bindingId, input) => manager.controlPlane.disableBinding(bindingId, input),
        rebindBinding: (bindingId, input) => manager.controlPlane.rebindBinding(bindingId, input),
        resume: (sessionId) => manager.controlPlane.resumeSession(sessionId),
        checkpoint: (sessionId) => manager.controlPlane.refreshCheckpoint(sessionId),
        share: (sessionId) => manager.controlPlane.shareSession(sessionId),
        close: (sessionId, input) => manager.controlPlane.closeSession(sessionId, input)
      },
      "/distill"
    );
    assert.equal(
      (commandResult as { contract_id: string; source_session_count: number }).contract_id,
      "local_distillation_v1"
    );
    assert.equal(
      (commandResult as { contract_id: string; source_session_count: number }).source_session_count,
      1
    );

    assert.equal(await pathExists(path.join(manager.tempRoot, "exports", "public-facts-outbox")), false);
    assert.equal(await pathExists(path.join(manager.tempRoot, "distillation_buffer.jsonl")), false);
  } finally {
    await manager.cleanup();
  }
});

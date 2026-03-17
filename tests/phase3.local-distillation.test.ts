import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { executeManagerCommand } from "../src/skill/commands.ts";
import { ManagerSidecarClient } from "../src/skill/sidecar-client.ts";
import type {
  LocalDistillationSnapshot,
  LocalDistilledFact
} from "../src/shared/types.ts";
import { createTempManager, dispatchRoute, pathExists, readJson, startTempSidecar } from "./helpers.ts";

function findFact(
  snapshot: LocalDistillationSnapshot,
  input: {
    scopeType: LocalDistilledFact["scope_type"];
    scopeRef: string;
    metricName: LocalDistilledFact["metric_name"];
    triggerType?: string;
  }
): LocalDistilledFact {
  const fact = snapshot.facts.find((candidate) => {
    if (
      candidate.scope_type !== input.scopeType ||
      candidate.scope_ref !== input.scopeRef ||
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
    `Missing fact ${input.scopeType}:${input.scopeRef}:${input.metricName}:${input.triggerType ?? "*"}`
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
      scopeType: "node",
      scopeRef: "global",
      metricName: "closure_rate"
    });
    assert.equal(globalClosure.metric_value, 0.75);
    assert.equal(globalClosure.sample_size, 4);

    const globalRecovery = findFact(snapshot, {
      scopeType: "node",
      scopeRef: "global",
      metricName: "recovery_success_rate"
    });
    assert.equal(globalRecovery.metric_value, 1);
    assert.equal(globalRecovery.sample_size, 2);

    const globalHumanIntervention = findFact(snapshot, {
      scopeType: "node",
      scopeRef: "global",
      metricName: "human_intervention_rate"
    });
    assert.equal(globalHumanIntervention.metric_value, 0.1667);
    assert.equal(globalHumanIntervention.sample_size, 6);

    const globalBlockedRecurrence = findFact(snapshot, {
      scopeType: "node",
      scopeRef: "global",
      metricName: "blocked_recurrence_rate"
    });
    assert.equal(globalBlockedRecurrence.metric_value, 1);
    assert.equal(globalBlockedRecurrence.sample_size, 1);

    const manualTrigger = findFact(snapshot, {
      scopeType: "node",
      scopeRef: "global",
      metricName: "run_trigger_rate",
      triggerType: "manual"
    });
    assert.equal(manualTrigger.metric_value, 0.6667);
    assert.equal(manualTrigger.metadata.count, 4);

    const resumeTrigger = findFact(snapshot, {
      scopeType: "node",
      scopeRef: "global",
      metricName: "run_trigger_rate",
      triggerType: "resume"
    });
    assert.equal(resumeTrigger.metric_value, 0.1667);
    assert.equal(resumeTrigger.metadata.count, 1);

    const retryTrigger = findFact(snapshot, {
      scopeType: "node",
      scopeRef: "global",
      metricName: "run_trigger_rate",
      triggerType: "retry"
    });
    assert.equal(retryTrigger.metric_value, 0.1667);
    assert.equal(retryTrigger.metadata.count, 1);

    const alphaClosure = findFact(snapshot, {
      scopeType: "scenario",
      scopeRef: "scenario.alpha",
      metricName: "closure_rate"
    });
    assert.equal(alphaClosure.metric_value, 0.5);
    assert.equal(alphaClosure.sample_size, 2);

    const betaRecovery = findFact(snapshot, {
      scopeType: "scenario",
      scopeRef: "scenario.beta",
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
  const sidecar = await startTempSidecar();

  try {
    const client = new ManagerSidecarClient({ baseUrl: sidecar.baseUrl });

    const initial = await client.getLocalDistillation();
    assert.ok(initial);
    assert.equal(initial.contract_id, "local_distillation_v1");
    assert.equal(initial.source_session_count, 0);
    assert.equal(initial.source_run_count, 0);

    const adopted = await client.adopt({
      title: "Local distillation route flow",
      objective: "Verify local distillation stays local-only."
    });
    await sidecar.controlPlane.settleActiveRun(adopted.session.session_id, {
      status: "completed",
      summary: "Route flow completed.",
      reason_code: "route_done"
    });
    await client.close(adopted.session.session_id, {
      outcome_summary: "Route flow closed."
    });

    const routeResponse = await dispatchRoute(sidecar.server, "GET", "/distillation/local");
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

    const recomputed = await dispatchRoute(sidecar.server, "POST", "/distill");
    assert.equal(recomputed.statusCode, 200);
    assert.equal(
      (recomputed.body as { contract_id: string; source_session_count: number }).source_session_count,
      1
    );

    const commandResult = await executeManagerCommand(client, "/distill");
    assert.equal(
      (commandResult as { contract_id: string; source_session_count: number }).contract_id,
      "local_distillation_v1"
    );
    assert.equal(
      (commandResult as { contract_id: string; source_session_count: number }).source_session_count,
      1
    );

    assert.equal(await pathExists(path.join(sidecar.tempRoot, "outbox")), false);
    assert.equal(await pathExists(path.join(sidecar.tempRoot, "distillation_buffer.jsonl")), false);
  } finally {
    await sidecar.cleanup();
  }
});

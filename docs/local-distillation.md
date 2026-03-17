# Local Distillation

This document freezes the first local-only distillation layer for OpenClaw Manager.

## Scope

- Input: durable terminal `session` state plus durable `run` history and durable `skill_trace` history.
- Output: one stable snapshot at `indexes/local_distillation.json`.
- Read surface: `GET /distillation/local`.
- Recompute surface: `POST /distill` and `/distill`.

This layer is strictly node-local. It emits formal [`CapabilityFact`](/Users/yangshangqing/metaclaw/docs/capability-fact-contract.md) objects but must not create outbox batches, node fingerprints, or network submission side effects by itself.

## Current Metrics

- `closure_rate`: completed terminal sessions / all terminal sessions in scope.
- `recovery_success_rate`: ended `resume` or `retry` runs that advanced the committed recovery head / all ended `resume` or `retry` runs in scope.
- `human_intervention_rate`: ended runs with `status=waiting_human` or `outcome.human_takeover=true` / all ended runs in scope.
- `blocked_recurrence_rate`: sessions with at least two blocked runs / sessions with at least one blocked run in scope.
- `run_trigger_rate`: per-trigger run count / total runs in scope.
- `invocation_count`: skill trace count in scope.
- `success_rate` / `failure_rate`: successful or failed skill traces / all skill traces in scope.
- `avg_duration_ms`: average duration across skill traces in scope.
- `avg_closure_contribution`: average `closure_contribution_score` across skill traces in scope.
- `primary_contribution_rate` / `regressive_rate`: primary or regressive skill traces / all skill traces in scope.
- `blocker_trigger_rate`: skill traces whose containing run ended `blocked` / all skill traces in scope.
- `workflow_closure_rate`: completed terminal sessions / all terminal sessions for the workflow signature.
- `workflow_efficiency`: completed sessions / total runs across completed sessions for the workflow signature.

## Scope Model

- `subject_type=node`, `subject_ref=global`: aggregate across all terminal sessions.
- `subject_type=scenario`, `subject_ref=<scenario_signature>`: aggregate per scenario signature.
- `subject_type=skill`, `subject_ref=<skill_name>`, `subject_version=<skill_version | null>`: aggregate from durable skill traces, emitted for `all_scenarios` and per-scenario windows.
- `subject_type=workflow`, `subject_ref=<sorted skill-set signature>`: aggregate from terminal sessions whose runs invoked that skill set, emitted for `all_scenarios` and per-scenario windows.
- Sessions without an explicit scenario use `general.task_management`.

## Stability Rules

- Only terminal sessions participate in the snapshot.
- The snapshot is recomputed from durable state; it is not maintained as incremental counters.
- Closing a session refreshes the local snapshot automatically.
- Each aggregate fact carries `aggregation_window` and `privacy`.
- `/distill` is local recomputation only. Public ingest remains a future, separate pipeline defined by [`docs/public-ingest-contract.md`](/Users/yangshangqing/metaclaw/docs/public-ingest-contract.md).

## Baseline Tests

- [`tests/phase3.local-distillation.test.ts`](/Users/yangshangqing/metaclaw/tests/phase3.local-distillation.test.ts)
- [`tests/phase3.public-fact-submission.test.ts`](/Users/yangshangqing/metaclaw/tests/phase3.public-fact-submission.test.ts)
- [`tests/phase1.static-boundary.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.static-boundary.test.ts)

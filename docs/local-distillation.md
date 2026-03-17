# Local Distillation

This document freezes the first local-only distillation layer for OpenClaw Manager.

## Scope

- Input: durable terminal `session` state plus durable `run` history.
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

## Scope Model

- `subject_type=node`, `subject_ref=global`: aggregate across all terminal sessions.
- `subject_type=scenario`, `subject_ref=<scenario_signature>`: aggregate per scenario signature.
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

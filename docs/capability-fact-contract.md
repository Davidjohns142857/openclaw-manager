# Capability Fact Contract

This document freezes the node-local `CapabilityFact` object used by distillation, outbox batching, and future transport submission.

## Minimum Shape

Every fact must include:

- `fact_id`
- `fact_kind`
- `subject`
- `scenario_signature`
- `metric_name`
- `metric_value`
- `sample_size`
- `confidence`
- `aggregation_window`
- `computed_at`
- `privacy`

## Subject

`subject` is the stable aggregation anchor:

- `subject.subject_type`
- `subject.subject_ref`
- `subject.subject_version`

Current local aggregate facts use:

- `subject_type=node`, `subject_ref=global`
- `subject_type=scenario`, `subject_ref=<scenario_signature>`
- `subject_type=skill`, `subject_ref=<skill_name>`, `subject_version=<skill_version | null>`
- `subject_type=workflow`, `subject_ref=<sorted skill-set signature>`

Raw closure facts still use `subject_type=session`.

## Aggregation Window

`aggregation_window` is mandatory:

- `window_type`
- `start_at`
- `end_at`

Current local aggregate facts use `window_type=closed_session_history`.
Raw closure facts use `window_type=point_in_time`.

## Privacy Declaration

`privacy` is mandatory and must declare:

- `privacy_tier`
- `export_policy`
- `contains_identifiers`
- `contains_content`
- `declaration`

Current rule:

- raw node facts are `export_policy=local_only`
- aggregated node/scenario/skill/workflow facts are `export_policy=public_submit_allowed`

## Stability Rules

- Aggregate fact ids must be stable across recomputation when the underlying durable window does not change.
- `/distill` recomputes local facts but does not create outbox batches by itself.
- Outbox batch builder selects facts by `privacy.export_policy`.

## Baseline Tests

- [`tests/phase3.local-distillation.test.ts`](/Users/yangshangqing/metaclaw/tests/phase3.local-distillation.test.ts)
- [`tests/phase3.public-fact-submission.test.ts`](/Users/yangshangqing/metaclaw/tests/phase3.public-fact-submission.test.ts)

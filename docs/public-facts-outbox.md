# Public Facts Outbox

This document freezes the node-side outbox and submit state machine. It is transport-first, not server-first.

## States

- `pending`: batch exists and has not been claimed for transport
- `claimed`: node is attempting submission
- `acked`: accepted or duplicate; terminal success state
- `failed_retryable`: transport failed but the same batch must be retried unchanged
- `dead_letter`: transport rejected the batch; terminal failure state

## Batch Rules

- A batch is identified by `batch_id`.
- A batch carries stable `fact_ids`, `facts`, and `content_hash`.
- Retrying the same batch must keep `batch_id` and `content_hash` unchanged.
- Facts already claimed by any batch state are not re-packed into a new batch.

## Receipt Rules

Each submission attempt must leave durable receipt history with:

- `receipt_id`
- `batch_id`
- `attempt_number`
- `mode`
- `result`
- `from_state`
- `to_state`
- `response_code`
- `transport_reference`
- `recorded_at`

Duplicate is treated as logical success:

- receipt result is `duplicate`
- batch still moves to `acked`

Retryable error keeps the original batch alive:

- receipt result is `retryable_error`
- batch moves to `failed_retryable`

Rejected is terminal:

- receipt result is `rejected`
- batch moves to `dead_letter`

## Modes

- `dry-run`: validate fact selection and batch splitting without writing outbox state
- `local-file`: exercise outbox state transitions and receipt writing against a local file sink
- `mock-http`: exercise accepted / duplicate / retryable_error / rejected branches without a real server

## Surfaces

- `POST /public-facts/submit`
- `GET /public-facts/outbox`
- `GET /public-facts/outbox/:batch_id`
- `/submit-public-facts`

## Baseline Tests

- [`tests/phase3.public-fact-submission.test.ts`](/Users/yangshangqing/metaclaw/tests/phase3.public-fact-submission.test.ts)

# Public Fact Auto Submit

This document freezes the first sidecar-owned background submit loop for public capability facts.

## Current Contract

- Auto submit is a sidecar background task.
- It only uses `mode=http`.
- It never bypasses local distillation or the outbox state machine.
- It periodically runs `distill -> submitPublicFacts(mode=http)`.
- Retryable outbox batches remain durable and are retried unchanged on later ticks.

## Config

The loop is controlled through `ManagerConfig.public_facts`:

- `endpoint`
- `timeout_ms`
- `schema_version`
- `auth_token`
- `auto_submit_enabled`
- `auto_submit_interval_ms`
- `auto_submit_startup_delay_ms`
- `auto_submit_max_batch_size`
- `auto_submit_max_batches`
- `auto_submit_retry_failed_retryable`

Environment variables:

- `OPENCLAW_MANAGER_PUBLIC_FACTS_ENDPOINT`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_TIMEOUT_MS`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_SCHEMA_VERSION`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTH_TOKEN`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_ENABLED`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_INTERVAL_MS`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_STARTUP_DELAY_MS`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_MAX_BATCH_SIZE`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_MAX_BATCHES`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_RETRY_FAILED_RETRYABLE`

Current default endpoint is `http://142.171.114.18:56557/v1/ingest`.

## Health Surface

`GET /health` exposes:

- `public_facts.endpoint`
- `public_facts.schema_version`
- `public_facts.auto_submit.enabled`
- `public_facts.auto_submit.interval_ms`
- `public_facts.auto_submit.in_flight`
- `public_facts.auto_submit.total_ticks`
- `public_facts.auto_submit.last_tick_at`
- `public_facts.auto_submit.last_success_at`
- `public_facts.auto_submit.last_result`
- `public_facts.auto_submit.last_error`

## Stability Rules

- Auto submit is a derived/background surface; it must not affect Phase 1 session/run/event guarantees.
- Failures must not delete pending or failed-retryable batches.
- Duplicate/accepted/rejected semantics are still owned by the outbox receipt contract.
- Auto submit assumes OpenClaw and the manager sidecar are co-located when the sidecar base URL is `127.0.0.1`.

## Baseline Tests

- [`tests/phase3.public-fact-auto-submit.test.ts`](/Users/yangshangqing/metaclaw/tests/phase3.public-fact-auto-submit.test.ts)
- [`tests/phase3.public-fact-submission.test.ts`](/Users/yangshangqing/metaclaw/tests/phase3.public-fact-submission.test.ts)

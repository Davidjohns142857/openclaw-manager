# HTTP And Protocol Boundary

This document defines the current OpenClaw Manager transport stance for Phase 1. It is informed by the same RemoteLab principle that treats HTTP as canonical state and treats realtime push as an optimization rather than the source of truth.

Reference inspiration:

- [RemoteLab README](https://github.com/Ninglo/remotelab)
- [RemoteLab external-message-protocol.md](https://raw.githubusercontent.com/Ninglo/remotelab/main/docs/external-message-protocol.md)
- [RemoteLab project-architecture.md](https://raw.githubusercontent.com/Ninglo/remotelab/main/docs/project-architecture.md)

## Core Stance

- HTTP is the canonical read/write path.
- Runtime processes and future WebSocket invalidations are disposable.
- Files on disk are the durable system of record.
- Connectors normalize upstream semantics before crossing into the control plane.

## Boundary Split

### Outside the control plane

External systems own:

- thread semantics
- approval and reply formatting
- source-specific auth and webhook validation
- mapping platform events into normalized inbound messages

### Inside the control plane

OpenClaw Manager owns:

- session creation and reuse
- run lifecycle transitions
- event persistence
- checkpoint and summary refresh
- attention derivation
- snapshot export

## Canonical Ingress Contract

Current normalized ingress endpoint:

- `POST /inbound-message`

Current normalized request shape:

```json
{
  "request_id": "req_...",
  "external_trigger_id": "ext_...",
  "source_type": "telegram",
  "source_thread_key": "tg_thread_123",
  "target_session_id": "sess_...",
  "message_type": "user_message",
  "content": "normalized content",
  "attachments": [],
  "metadata": {}
}
```

Boundary rules:

- `request_id` is the idempotency key for one inbound update.
- `source_type` and `source_thread_key` remain connector-owned metadata, not core workflow branches.
- every inbound update is reduced to one user-facing message unit
- connector-specific rendering stays outside the manager

## Current Response Contract

`POST /inbound-message` returns:

- `duplicate`: whether the same `request_id` was already accepted
- `queued`: whether the update was stored without starting a new run immediately
- `run_started`: whether a run started immediately
- `run`: the active run object or `null`
- `session`: the refreshed session payload plus canonical `activity`

The `session.activity` block is the server-authored client contract for high-level status:

- `activity.run.state`
- `activity.run.phase`
- `activity.queue.state`
- `activity.queue.count`
- `activity.summary.state`

Clients should prefer this derived contract over inventing local lifecycle logic.

## Read Paths

Current canonical read endpoints:

- `GET /health`
- `GET /sessions`
- `GET /sessions/:session_id`
- `GET /focus`
- `GET /digest`

Current canonical mutating endpoints that also return the same session-detail envelope:

- `POST /adopt`
- `POST /sessions/:session_id/resume`
- `POST /sessions/:session_id/checkpoint`
- `POST /sessions/:session_id/close`

If a future WebSocket layer is added, it should only emit invalidation hints such as:

- session changed
- session list changed
- attention queue changed

That push channel should never become the authoritative state path.

## Idempotency And Delivery

- `request_id` is claimed atomically at the filesystem ingress boundary before events are emitted.
- Duplicate deliveries for the same `request_id` return the canonical session payload without re-emitting message facts.
- Connector retries should reuse the same `request_id` rather than inventing a fresh one.

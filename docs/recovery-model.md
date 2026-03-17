# Summary Recovery Model

This document defines how OpenClaw Manager recovers long-running work without replaying full chat history.

Reference inspiration:

- [RemoteLab README](https://github.com/Ninglo/remotelab)
- [RemoteLab project-architecture.md](https://raw.githubusercontent.com/Ninglo/remotelab/main/docs/project-architecture.md)

## Recovery Principle

The system restores task state from durable recovery artifacts, not from transport continuity.

In practice that means:

- `checkpoint.json` is the machine-facing recovery head
- `summary.md` is the human-facing compressed view
- `recovery-head.json` is the commit fence proving which checkpoint/summary transaction is authoritative
- `events.jsonl` remains the factual audit trail
- `spool.jsonl` remains low-level execution evidence

## Recovery Order

### 1. Read checkpoint first

The checkpoint answers:

- what phase the session is in
- what blockers and pending decisions exist
- what external inputs are still pending
- what machine and human actions should happen next
- which artifacts belong to the active run

The checkpoint is only trusted when its transaction marker matches `recovery-head.json`.

### 2. Read summary second

The summary answers:

- what the task is trying to accomplish
- what has already happened
- what matters right now
- what a human should look at next

The summary is treated as a cache over the committed recovery head. If its transaction marker is stale or missing, it is regenerated from the committed checkpoint rather than from mutable session state.

### 3. Read events only when deeper evidence is needed

Event replay is for:

- audit
- debugging
- telemetry
- later capability distillation

It is not the first recovery surface.

## Why This Matters

This follows the same operating assumption highlighted in RemoteLab: the product should optimize for restart-safe logical recovery, not for pretending a live connection is the truth.

For OpenClaw Manager, that means a resumed thread should come back from:

- `session.json`
- the latest `checkpoint.json`
- `summary.md`

and only then fall through to lower-level evidence if the higher-level recovery surfaces are missing or stale.

## Current Code Mapping

- Session truth: [`src/control-plane/session-service.ts`](/Users/yangshangqing/metaclaw/src/control-plane/session-service.ts)
- Run truth: [`src/control-plane/run-service.ts`](/Users/yangshangqing/metaclaw/src/control-plane/run-service.ts)
- Recovery artifact writing: [`src/control-plane/checkpoint-service.ts`](/Users/yangshangqing/metaclaw/src/control-plane/checkpoint-service.ts)
- Resume orchestration: [`src/control-plane/control-plane.ts`](/Users/yangshangqing/metaclaw/src/control-plane/control-plane.ts)
- Durable files: [`src/storage/fs-store.ts`](/Users/yangshangqing/metaclaw/src/storage/fs-store.ts)

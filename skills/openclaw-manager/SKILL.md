---
name: openclaw-manager
description: Manage OpenClaw task sessions, run recovery, attention queues, checkpoints, and share snapshots through a filesystem-first control plane. Use when the user needs to adopt a chat into a durable session, resume a stalled task, inspect multi-task state, or export a task snapshot.
---

# OpenClaw Manager

Use this skill when the user is managing long-running OpenClaw work rather than asking for one-off chat output.

## Use This Skill For

- upgrading a chat thread into a durable session with `/adopt`
- reviewing active sessions with `/tasks`
- restoring recoverable state with `/resume <session_id>`
- checking human-facing priority with `/focus`
- exporting a session snapshot with `/share <session_id>`
- closing or checkpointing a thread with `/close` or `/checkpoint`

## Working Rules

1. Treat `session`, `run`, and `event` as the primary truth, not raw chat replay.
2. Prefer reading `checkpoint.json` and `summary.md` before inspecting lower-level logs.
3. Keep connector semantics out of the core control plane; all external input should pass through the normalized inbound-message contract.
4. Use append-only writes for event, trace, and capability-fact streams.

## References

- Command and API contracts: [references/command-contracts.md](/Users/yangshangqing/metaclaw/skills/openclaw-manager/references/command-contracts.md)
- Phase 1 operating boundaries: [references/operating-boundaries.md](/Users/yangshangqing/metaclaw/skills/openclaw-manager/references/operating-boundaries.md)


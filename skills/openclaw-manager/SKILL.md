---
name: openclaw-manager
description: Manage OpenClaw task sessions, run recovery, attention queues, checkpoints, and share snapshots through a filesystem-first control plane. Use when the user needs to adopt a chat into a durable session, resume a stalled task, inspect multi-task state, or export a task snapshot.
homepage: https://github.com/Davidjohns142857/openclaw-manager
metadata: {"openclaw":{"homepage":"https://github.com/Davidjohns142857/openclaw-manager","requires":{"bins":["node"]},"install":[{"id":"manager-bundle","kind":"download","url":"https://github.com/Davidjohns142857/openclaw-manager/archive/refs/heads/codex/ysq-host-boundary-contracts.tar.gz","archive":"tar.gz","extract":true,"stripComponents":1,"targetDir":"~/.openclaw/tools/openclaw-manager","label":"Download OpenClaw Manager bundle"}]}}
---

# OpenClaw Manager

Use this skill when the user is managing long-running OpenClaw work rather than asking for one-off chat output.

## Use This Skill For

- upgrading a chat thread into a durable session with `/adopt`
- reviewing active sessions with `/tasks`
- restoring recoverable state with `/resume <session_id>`
- checking human-facing priority with `/focus`
- generating a compressed multi-task digest with `/digest`
- recomputing node-local distilled stats with `/distill`
- building or submitting exportable local fact batches with `/submit-public-facts` over dry-run, local-file, mock-http, or configured live HTTP transport
- exporting a session snapshot with `/share <session_id>`
- binding an external source thread with `/bind <session_id> <source_type> <source_thread_key>`
- disabling or moving an external source binding with `/unbind <binding_id>` or `/rebind <binding_id> <session_id>`
- closing or checkpointing a thread with `/close` or `/checkpoint`

## Working Rules

1. Treat `session`, `run`, and `event` as the primary truth, not raw chat replay.
2. Prefer reading `checkpoint.json` and `summary.md` before inspecting lower-level logs.
3. Keep connector semantics out of the core control plane; all external input should pass through the normalized inbound-message contract.
4. Use append-only writes for event, trace, and capability-fact streams.
5. Treat the local sidecar HTTP API as the canonical skill boundary; do not bypass it by importing control-plane internals into host-facing command code.
6. Only surface a session console URL to end users when `GET /health -> ui.session_console_url` is non-null. Do not fall back to `127.0.0.1` for remote or mobile users.
7. Normal install/setup means local same-machine chain first: local OpenClaw Gateway, local manager sidecar, optional local pre-routing hook, optional public ingest.
8. Do not default to SSH, `systemctl`, remote `git pull`, SCP, or VPS deployment unless the user explicitly asks to manage remote infrastructure.
9. For first-time local setup, prefer `node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts`.
10. If hook install is unavailable, explicitly tell the user the system is in manual `/adopt` mode instead of claiming automatic interception.
11. Never expose the manager sidecar port publicly. If remote/mobile UI is needed, use only a dedicated read-only UI proxy or Gateway/reverse-proxy URL, and never reuse the public ingest host:port as a UI origin.
12. When a user asks “how do I start using this?” or “what should I do after install?”, summarize [`FIRST_RUN.md`](/Users/yangshangqing/metaclaw/FIRST_RUN.md) before diving into deployment details.

## References

- Command and API contracts: [references/command-contracts.md](/Users/yangshangqing/metaclaw/skills/openclaw-manager/references/command-contracts.md)
- Phase 1 operating boundaries: [references/operating-boundaries.md](/Users/yangshangqing/metaclaw/skills/openclaw-manager/references/operating-boundaries.md)
- Install and host setup flow: [INSTALL.md](/Users/yangshangqing/metaclaw/skills/openclaw-manager/INSTALL.md)
- First-run onboarding: [FIRST_RUN.md](/Users/yangshangqing/metaclaw/FIRST_RUN.md)

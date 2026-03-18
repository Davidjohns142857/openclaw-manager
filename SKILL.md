---
name: openclaw-manager
description: Run a local same-machine control plane for durable OpenClaw sessions, runs, checkpoints, focus, and local/public capability facts.
homepage: https://github.com/Davidjohns142857/openclaw-manager
user-invocable: true
metadata: {"openclaw":{"homepage":"https://github.com/Davidjohns142857/openclaw-manager","requires":{"bins":["node"]},"install":[{"id":"manager-bundle","kind":"download","url":"https://github.com/Davidjohns142857/openclaw-manager/archive/refs/heads/codex/ysq-host-boundary-contracts.tar.gz","archive":"tar.gz","extract":true,"stripComponents":1,"targetDir":"~/.openclaw/tools/openclaw-manager","label":"Download OpenClaw Manager bundle"}]}}
---

# OpenClaw Manager

Use this skill when the user is managing long-running work through a local OpenClaw Manager sidecar rather than asking for one-off chat output.

## Normal Topology

The normal install topology is:

- OpenClaw Gateway on the local machine
- `openclaw-manager` sidecar on the same machine
- optional published UI / reverse proxy if end users must open the console from another device
- optional public ingest at `http://142.171.114.18:56557/v1/ingest`

This skill is not a normal-purpose VPS deployment workflow.

Unless the user explicitly asks to manage remote infrastructure, do not default to:

- SSH
- `systemctl`
- `git pull`
- SCP / rsync
- cloning the manager repo onto a VPS

When the user says “install”, “configure”, or “enable” this skill, assume they mean the local same-machine chain first.

## First Step

Read `{baseDir}/INSTALL.md` and follow the local-chain setup flow there.

## Working Rules

1. Treat `session`, `run`, and `event` as the primary truth, not raw chat replay.
2. Prefer the local sidecar HTTP API as the canonical boundary.
3. Treat the default path as local sidecar + local hook + optional public ingest.
4. Only discuss remote deploy/update if the user explicitly asks about a remote host or VPS.
5. Only surface a session console URL to end users when `/health -> ui.session_console_url` is non-null. Do not send `127.0.0.1` URLs to remote or mobile users.
6. If hook install is unavailable, fall back to manual `/adopt` workflow instead of claiming automatic interception.
7. When checking public facts, verify local sidecar `/health` and the public ingest `/v1/health` / `/v1/facts`, not `/v1/`.

## References

- Install flow: `{baseDir}/INSTALL.md`
- Manager skill bundle: `{baseDir}/skills/openclaw-manager/SKILL.md`
- Host pre-routing contract: `{baseDir}/docs/openclaw-host-prerouting-hook.md`

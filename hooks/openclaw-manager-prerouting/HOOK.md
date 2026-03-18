---
name: openclaw-manager-prerouting
description: "Run OpenClaw Manager admission on inbound messages before the default skill flow."
homepage: https://github.com/Davidjohns142857/openclaw-manager
metadata: {"openclaw":{"emoji":"🧭","events":["message:received"],"requires":{"bins":["node"]}}}
---

# OpenClaw Manager Pre-Routing Hook

This hook lets OpenClaw Manager look at ordinary inbound messages early and decide whether to:

- do nothing
- suggest `/adopt`
- directly capture the message into manager

## What It Does

- listens on `message:received`
- calls the local manager sidecar at `POST /host/prerouting`
- surfaces a short user-visible suggestion or capture acknowledgement message

## Requirements

- OpenClaw Gateway and `openclaw-manager` sidecar should run on the same machine
- the manager sidecar should be reachable at `http://127.0.0.1:8791` unless `OPENCLAW_MANAGER_BASE_URL` overrides it

## Important Limits

- this hook performs admission and user-visible suggestion/ack flow
- it does not mutate manager durable state directly; the sidecar remains canonical
- it does not hard-stop OpenClaw core routing by itself; hard short-circuit still requires host/runtime support beyond generic hook install

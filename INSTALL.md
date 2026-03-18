# Install OpenClaw Manager

This repository is meant to be used as a local same-machine OpenClaw skill bundle.

The intended chain is:

- OpenClaw Gateway locally
- `openclaw-manager` sidecar locally
- pre-routing hook locally when the host gateway is user-managed
- public ingest remotely at `http://142.171.114.18:56557/v1/ingest`

Normal install is not a VPS deployment flow.

## Install Action

`metadata.openclaw.install` downloads the manager bundle into:

- `~/.openclaw/tools/openclaw-manager`

That bundle contains:

- `scripts/setup-openclaw-local-chain.ts`
- `scripts/run-local-sidecar.ts`
- `scripts/doctor-local-chain.ts`
- `hooks/openclaw-manager-prerouting/`
- the full sidecar source and UI
- `FIRST_RUN.md`

## One-Time Local Setup

Run:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts
```

Canonical one-line command: `node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts`

If you also want public facts auto-submit enabled:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts --enable-public-facts
```

If OpenClaw is running in a hosted / Cloud environment where you cannot install hooks into the gateway, use:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts --cloud-hosted --enable-public-facts
```

Cloud/manual flag: `--cloud-hosted`

In Cloud/manual mode, if auto-submit is enabled and you do not explicitly pass `--ui-public-base-url`, setup will default the published read-only UI to the public-facts host on port `18891`.

If you need the session console to be reachable from another device, publish the sidecar behind your own externally reachable base URL and pass:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts --ui-public-base-url http://your-host.example.com:18891
```

Published UI flag: `--ui-public-base-url http://your-host.example.com:18891`
Short flag form: `--ui-public-base-url`

Gateway / reverse-proxy example: `--ui-public-base-url https://your-manager.example.com`

If you want the manager itself to bind a separate published read-only UI proxy port, pass:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts --ui-public-base-url http://your-host.example.com:18891 --publish-ui-port 18891
```

This published UI URL must stay separate from both:

- the raw sidecar port
- the public ingest host:port `142.171.114.18:56557`

It also must not reuse `56557/v1/ingest`.

You have two valid publication modes:

- Gateway / reverse-proxy URL
- dedicated published read-only UI proxy on its own port

This setup does three things:

1. writes local runtime config
2. installs/enables the local pre-routing hook
3. installs a local sidecar user service
   macOS: `launchd`
   Linux: `systemd --user`

After setup, the canonical user onboarding document is:

- [`FIRST_RUN.md`](/Users/yangshangqing/metaclaw/FIRST_RUN.md)

That is the document that should be summarized to end users when they ask:

- “How do I actually use this?”
- “When should I `/adopt`?”
- “What do `/tasks` and `/focus` do?”

## Verification

After setup:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/doctor-local-chain.ts
```

Canonical verification command: `node ~/.openclaw/tools/openclaw-manager/scripts/doctor-local-chain.ts`

Key surfaces:

- local sidecar health: `http://127.0.0.1:8791/health`
- local UI admin surface: `http://127.0.0.1:8791/ui`
- public ingest health: `http://142.171.114.18:56557/v1/health`
- public facts list: `http://142.171.114.18:56557/v1/facts`

`http://127.0.0.1:8791/ui` is only a same-machine admin URL. Do not send it to mobile or remote users unless you have explicitly published a separate external UI URL.

That external UI URL must stay separate from public ingest and from the raw sidecar port. See [`docs/cloud-deploy-boundary.md`](/Users/yangshangqing/metaclaw/docs/cloud-deploy-boundary.md).

Do not use `http://142.171.114.18:56557/v1/` as the verification target.

## Explicit Non-Goals During Normal Install

Do not treat normal skill install/setup as:

- cloning this repo onto a VPS
- restarting a remote `systemd` service
- SSH maintenance
- remote code deployment

Those are separate admin tasks, not the default skill install path.

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

If you need the session console to be reachable from another device, publish the sidecar behind your own externally reachable base URL and pass:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts --ui-public-base-url https://your-manager.example.com
```

Published UI flag: `--ui-public-base-url https://your-manager.example.com`
Short flag form: `--ui-public-base-url`

This published UI URL must be a Gateway / reverse-proxy URL. It must not be the raw sidecar port, and it must not reuse `56557/v1/ingest`.

This setup does three things:

1. writes local runtime config
2. installs/enables the local pre-routing hook
3. installs a local sidecar user service
   macOS: `launchd`
   Linux: `systemd --user`

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

`http://127.0.0.1:8791/ui` is only a same-machine admin URL. Do not send it to mobile or remote users unless you have explicitly published the sidecar through an external base URL.

That external base URL must stay separate from public ingest. See [`docs/cloud-deploy-boundary.md`](/Users/yangshangqing/metaclaw/docs/cloud-deploy-boundary.md).

Do not use `http://142.171.114.18:56557/v1/` as the verification target.

## Explicit Non-Goals During Normal Install

Do not treat normal skill install/setup as:

- cloning this repo onto a VPS
- restarting a remote `systemd` service
- SSH maintenance
- remote code deployment

Those are separate admin tasks, not the default skill install path.

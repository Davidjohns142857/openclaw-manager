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

In Cloud/manual mode, remote/mobile users should use Viewer Board instead of the raw sidecar UI. Setup now auto-registers a board token by default:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts \
  --cloud-hosted \
  --enable-public-facts
```

During setup, manager will:

- generate a local board identity
- call `http://142.171.114.18:18991/register`
- write `board-config.json`
- start sidecar push automatically on future launches

If registration succeeds, setup derives:

- board push URL: `http://142.171.114.18:18991/board-sync/bt_xxx`
- user board URL: `http://142.171.114.18:18991/board/bt_xxx/`

Relevant flags:

- `--board-token bt_xxx` to force a known token
- `--board-push-url http://your-host.example.com:18991/board-sync/bt_xxx`
- `--board-port 18991`
- `--board-register-url http://your-host.example.com:18991/register`

Do not send `http://127.0.0.1:8791/ui` to remote/mobile users.

If you are enabling the shared Viewer Board, follow:

- [`docs/viewer-board-setup-checklist.md`](/Users/yangshangqing/metaclaw/docs/viewer-board-setup-checklist.md)

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

After setup, exact manager slash commands such as `/adopt`, `/tasks`, `/focus`, `/digest`, `/resume`, `/checkpoint`, and `/close` should execute as commands.

They should not be treated as a prompt to explain the command.

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

`http://127.0.0.1:8791/ui` is only a same-machine admin URL. Do not send it to mobile or remote users; use Viewer Board instead.

Viewer Board must stay separate from public ingest and from the raw sidecar port. See [`docs/cloud-deploy-boundary.md`](/Users/yangshangqing/metaclaw/docs/cloud-deploy-boundary.md).

Do not use `http://142.171.114.18:56557/v1/` as the verification target.

## Explicit Non-Goals During Normal Install

Do not treat normal skill install/setup as:

- cloning this repo onto a VPS
- restarting a remote `systemd` service
- SSH maintenance
- remote code deployment

Those are separate admin tasks, not the default skill install path.

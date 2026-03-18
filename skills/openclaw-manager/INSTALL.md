# Install OpenClaw Manager

This skill has two layers:

- the `SKILL.md` command surface
- the local manager bundle that runs the sidecar, UI, host pre-routing hook, and background public-fact submit loop

## Install Action

`metadata.openclaw.install` points OpenClaw at a downloadable manager bundle.

Current install action downloads this repository into:

- `~/.openclaw/tools/openclaw-manager`

This is the bundle that contains:

- `src/main.ts`
- `ui/session-console/`
- `hooks/openclaw-manager-prerouting/`
- `scripts/setup-openclaw-host.ts`

## Important Limitation

Current OpenClaw skill install actions can fetch the bundle, but they do not run arbitrary post-install setup flows or custom prompts.

That means:

- the skill can be installed automatically
- the manager bundle can be downloaded automatically
- enabling host pre-routing still requires one explicit setup command

## One-Time Setup

After install, run:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-host.ts
```

Canonical one-line command: `node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-host.ts`

This helper will:

- install the managed hook from `hooks/openclaw-manager-prerouting/`
- enable that hook in OpenClaw
- remind you to restart the OpenClaw gateway

The underlying OpenClaw CLI calls are:

- `openclaw hooks install -l`
- `openclaw hooks enable openclaw-manager-prerouting`

To disable the hook later:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-host.ts --disable-pre-routing
```

## Sidecar and Same-Machine Topology

The default setup assumes:

- OpenClaw Gateway and `openclaw-manager` sidecar run on the same machine
- the sidecar listens at `http://127.0.0.1:8791`

If you use a different local port, set:

```bash
export OPENCLAW_MANAGER_BASE_URL=http://127.0.0.1:8791
```

before starting OpenClaw.

## Public Facts

The manager can auto-submit local capability facts to the public ingest endpoint:

- `http://142.171.114.18:56557/v1/ingest`

Enable it through the sidecar environment:

```bash
export OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_ENABLED=1
export OPENCLAW_MANAGER_PUBLIC_FACTS_ENDPOINT=http://142.171.114.18:56557/v1/ingest
```

Verification:

- local sidecar health: `http://127.0.0.1:8791/health`
- local UI: `http://127.0.0.1:8791/ui`
- public ingest health: `http://142.171.114.18:56557/v1/health`
- public facts list: `http://142.171.114.18:56557/v1/facts`

Do not use `http://142.171.114.18:56557/v1/` as the verification target; the ingest endpoint is `/v1/ingest`, and read surfaces are `/v1/health` plus `/v1/facts`.

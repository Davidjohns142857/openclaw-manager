# OpenClaw Manager

OpenClaw Manager is a filesystem-first control plane for OpenClaw. It turns linear chat threads into recoverable `session` objects, tracks execution as `run` objects, and derives high-density human attention from normalized `event` streams.

This repository now also ships a public-facing root skill bundle:

- root skill manifest: [SKILL.md](/Users/yangshangqing/metaclaw/SKILL.md)
- root install guide: [INSTALL.md](/Users/yangshangqing/metaclaw/INSTALL.md)
- root agent metadata: [agents/openai.yaml](/Users/yangshangqing/metaclaw/agents/openai.yaml)

The intended normal topology is local-first:

- OpenClaw Gateway locally
- `openclaw-manager` sidecar locally
- managed pre-routing hook locally when Gateway hook control is available
- optional public ingest remotely

Normal install/setup should not be treated as a VPS deploy/update flow.

This repository now contains a Phase 1 MVP scaffold:

- a Node 24 + TypeScript sidecar skeleton under [`src/`](/Users/yangshangqing/metaclaw/src)
- formal JSON schemas under [`schemas/`](/Users/yangshangqing/metaclaw/schemas)
- a manager skill package under [`skills/openclaw-manager/`](/Users/yangshangqing/metaclaw/skills/openclaw-manager)
- a skill install/setup guide under [`skills/openclaw-manager/INSTALL.md`](/Users/yangshangqing/metaclaw/skills/openclaw-manager/INSTALL.md)
- markdown/html templates under [`templates/`](/Users/yangshangqing/metaclaw/templates)
- a requirement mapping from the source concept docs under [`docs/mvp-requirements.md`](/Users/yangshangqing/metaclaw/docs/mvp-requirements.md)
- explicit transport rules under [`docs/http-protocol-boundary.md`](/Users/yangshangqing/metaclaw/docs/http-protocol-boundary.md)
- explicit connector/binding rules under [`docs/connector-protocol.md`](/Users/yangshangqing/metaclaw/docs/connector-protocol.md)
- explicit run lifecycle rules under [`docs/run-lifecycle.md`](/Users/yangshangqing/metaclaw/docs/run-lifecycle.md)
- a first real GitHub connector contract under [`docs/github-connector.md`](/Users/yangshangqing/metaclaw/docs/github-connector.md)
- a thin browser-plugin connector contract under [`docs/browser-connector.md`](/Users/yangshangqing/metaclaw/docs/browser-connector.md)
- explicit recovery rules under [`docs/recovery-model.md`](/Users/yangshangqing/metaclaw/docs/recovery-model.md)
- an OpenClaw host integration contract under [`docs/openclaw-host-integration.md`](/Users/yangshangqing/metaclaw/docs/openclaw-host-integration.md)
- a host message capture / admission contract under [`docs/host-message-admission.md`](/Users/yangshangqing/metaclaw/docs/host-message-admission.md)
- an OpenClaw host pre-routing hook integration contract under [`docs/openclaw-host-prerouting-hook.md`](/Users/yangshangqing/metaclaw/docs/openclaw-host-prerouting-hook.md)
- a cloud deploy/network boundary under [`docs/cloud-deploy-boundary.md`](/Users/yangshangqing/metaclaw/docs/cloud-deploy-boundary.md)
- a managed OpenClaw hook pack under [`hooks/openclaw-manager-prerouting/`](/Users/yangshangqing/metaclaw/hooks/openclaw-manager-prerouting)
- an interaction semantics contract under [`docs/interaction-contract.md`](/Users/yangshangqing/metaclaw/docs/interaction-contract.md)
- a decision/blocker lifecycle contract under [`docs/decision-blocker-contract.md`](/Users/yangshangqing/metaclaw/docs/decision-blocker-contract.md)
- a reserved decision/blocker API contract under [`docs/decision-blocker-api-contract.md`](/Users/yangshangqing/metaclaw/docs/decision-blocker-api-contract.md)
- a reserved-contract implementation strategy under [`docs/reserved-contract-implementation-strategy.md`](/Users/yangshangqing/metaclaw/docs/reserved-contract-implementation-strategy.md)
- a local-only distillation contract under [`docs/local-distillation.md`](/Users/yangshangqing/metaclaw/docs/local-distillation.md)
- a stable local capability-fact contract under [`docs/capability-fact-contract.md`](/Users/yangshangqing/metaclaw/docs/capability-fact-contract.md)
- a node-side outbox / submit contract under [`docs/public-facts-outbox.md`](/Users/yangshangqing/metaclaw/docs/public-facts-outbox.md)
- a background auto-submit contract under [`docs/public-fact-auto-submit.md`](/Users/yangshangqing/metaclaw/docs/public-fact-auto-submit.md)
- a current test coverage map under [`docs/test-functionality-list.md`](/Users/yangshangqing/metaclaw/docs/test-functionality-list.md)
- a guarded parallel-development handoff under [`docs/phase1-guarded-expansion-collaboration.md`](/Users/yangshangqing/metaclaw/docs/phase1-guarded-expansion-collaboration.md)

## Current Scope

The current implementation targets Phase 1 from `openclaw_manager_overview.md`:

- `session` / `run` / `event` durable models
- filesystem-first state store
- checkpoint + summary recovery
- basic attention queue derivation
- local snapshot export
- local-only distilled node/scenario stats
- local outbox and dry-run / local-file / mock-http / http submission pipeline
- optional sidecar-owned background auto submit over `http`
- minimal sidecar API and skill command contracts

Out of scope for this scaffold:

- real Telegram / WeCom / email connectors
- SQLite query layer
- advanced capability graph aggregation
- rich dashboard UI

## Quick Start

1. Install dependencies: `npm install`
2. Start the sidecar locally: `npm run start`
3. Run the local smoke flow: `npm run smoke`

Local same-machine helpers:

- `npm run local:setup`
- `npm run local:start`
- `npm run local:doctor`

By default, runtime state is written to `.openclaw-manager-state/` in this repository. Override with `OPENCLAW_MANAGER_HOME=/path/to/state`.

If you want ordinary OpenClaw inbound messages to hit manager admission automatically, run the one-time setup helper after installing the bundle:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts
```

This writes local runtime config, installs/enables the managed hook at [`hooks/openclaw-manager-prerouting/`](/Users/yangshangqing/metaclaw/hooks/openclaw-manager-prerouting), and installs a local sidecar user service before asking you to restart the Gateway.

If OpenClaw is hosted and you do not control the Gateway hook directory or restart cycle, use:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts --cloud-hosted
```

That keeps sidecar setup and public-fact auto-submit available, but intentionally falls back to manual `/adopt` instead of pretending automatic interception is active.

If Cloud/manual mode also has public-facts auto-submit enabled, manager now defaults the published read-only UI to the same public host on port `18891` unless you explicitly override `--ui-public-base-url`.

Local verification helper:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/doctor-local-chain.ts
```

Public fact live-ingest defaults to `http://142.171.114.18:56557/v1/ingest`. Override with:

- `OPENCLAW_MANAGER_PUBLIC_FACTS_ENDPOINT`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_TIMEOUT_MS`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTH_TOKEN`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_SCHEMA_VERSION`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_ENABLED`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_INTERVAL_MS`
- `OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_STARTUP_DELAY_MS`

Verification surfaces:

- local sidecar health: `http://127.0.0.1:8791/health`
- local session console admin surface: `http://127.0.0.1:8791/ui`
- public ingest health: `http://142.171.114.18:56557/v1/health`
- public facts list: `http://142.171.114.18:56557/v1/facts`

By default, `http://127.0.0.1:8791/ui` is not a user-facing mobile URL. Only expose a session console link to end users if you have explicitly published a separate external UI URL.

Valid publication modes are:

- a Gateway / reverse-proxy URL
- a dedicated published read-only UI proxy on its own port

That external UI URL must not be the raw sidecar port and must not reuse the public ingest endpoint or host:port. See [`docs/cloud-deploy-boundary.md`](/Users/yangshangqing/metaclaw/docs/cloud-deploy-boundary.md).

## Repository Layout

- [`src/main.ts`](/Users/yangshangqing/metaclaw/src/main.ts): starts the local sidecar server
- [`src/control-plane/`](/Users/yangshangqing/metaclaw/src/control-plane): session, run, event, attention, share services
- [`src/storage/`](/Users/yangshangqing/metaclaw/src/storage): filesystem-first durable state layer
- [`src/api/server.ts`](/Users/yangshangqing/metaclaw/src/api/server.ts): minimal HTTP control plane API
- [`src/host/`](/Users/yangshangqing/metaclaw/src/host): thin host-side message admission and direct-ingress logic
- [`src/connectors/`](/Users/yangshangqing/metaclaw/src/connectors): normalized external-source adapters, currently including GitHub webhook and browser-plugin ingress adapters
- [`src/control-plane/binding-service.ts`](/Users/yangshangqing/metaclaw/src/control-plane/binding-service.ts): binding lifecycle, including bind, disable, rebind, and active-routing resolution
- [`ui/session-console/`](/Users/yangshangqing/metaclaw/ui/session-console): same-origin minimal session/run/outbox console served at `/ui`
- [`skills/openclaw-manager/SKILL.md`](/Users/yangshangqing/metaclaw/skills/openclaw-manager/SKILL.md): manager skill instructions and command surface
- [`src/skill/sidecar-client.ts`](/Users/yangshangqing/metaclaw/src/skill/sidecar-client.ts): thin OpenClaw host client for the local sidecar

## Source Documents

- [`openclaw_manager_overview.md`](/Users/yangshangqing/metaclaw/openclaw_manager_overview.md)
- [`openclaw_manager_schemas.md`](/Users/yangshangqing/metaclaw/openclaw_manager_schemas.md)
- [`SKILL_DEVELOPMENT_STANDARD.md`](/Users/yangshangqing/metaclaw/SKILL_DEVELOPMENT_STANDARD.md)

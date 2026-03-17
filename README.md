# OpenClaw Manager

OpenClaw Manager is a filesystem-first control plane for OpenClaw. It turns linear chat threads into recoverable `session` objects, tracks execution as `run` objects, and derives high-density human attention from normalized `event` streams.

This repository now contains a Phase 1 MVP scaffold:

- a Node 24 + TypeScript sidecar skeleton under [`src/`](/Users/yangshangqing/metaclaw/src)
- formal JSON schemas under [`schemas/`](/Users/yangshangqing/metaclaw/schemas)
- a manager skill package under [`skills/openclaw-manager/`](/Users/yangshangqing/metaclaw/skills/openclaw-manager)
- markdown/html templates under [`templates/`](/Users/yangshangqing/metaclaw/templates)
- a requirement mapping from the source concept docs under [`docs/mvp-requirements.md`](/Users/yangshangqing/metaclaw/docs/mvp-requirements.md)
- explicit transport rules under [`docs/http-protocol-boundary.md`](/Users/yangshangqing/metaclaw/docs/http-protocol-boundary.md)
- explicit recovery rules under [`docs/recovery-model.md`](/Users/yangshangqing/metaclaw/docs/recovery-model.md)
- an OpenClaw host integration contract under [`docs/openclaw-host-integration.md`](/Users/yangshangqing/metaclaw/docs/openclaw-host-integration.md)
- an interaction semantics contract under [`docs/interaction-contract.md`](/Users/yangshangqing/metaclaw/docs/interaction-contract.md)
- a current test coverage map under [`docs/test-functionality-list.md`](/Users/yangshangqing/metaclaw/docs/test-functionality-list.md)
- a guarded parallel-development handoff under [`docs/phase1-guarded-expansion-collaboration.md`](/Users/yangshangqing/metaclaw/docs/phase1-guarded-expansion-collaboration.md)

## Current Scope

The current implementation targets Phase 1 from `openclaw_manager_overview.md`:

- `session` / `run` / `event` durable models
- filesystem-first state store
- checkpoint + summary recovery
- basic attention queue derivation
- local snapshot export
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

By default, runtime state is written to `.openclaw-manager-state/` in this repository. Override with `OPENCLAW_MANAGER_HOME=/path/to/state`.

## Repository Layout

- [`src/main.ts`](/Users/yangshangqing/metaclaw/src/main.ts): starts the local sidecar server
- [`src/control-plane/`](/Users/yangshangqing/metaclaw/src/control-plane): session, run, event, attention, share services
- [`src/storage/`](/Users/yangshangqing/metaclaw/src/storage): filesystem-first durable state layer
- [`src/api/server.ts`](/Users/yangshangqing/metaclaw/src/api/server.ts): minimal HTTP control plane API
- [`skills/openclaw-manager/SKILL.md`](/Users/yangshangqing/metaclaw/skills/openclaw-manager/SKILL.md): manager skill instructions and command surface
- [`src/skill/sidecar-client.ts`](/Users/yangshangqing/metaclaw/src/skill/sidecar-client.ts): thin OpenClaw host client for the local sidecar

## Source Documents

- [`openclaw_manager_overview.md`](/Users/yangshangqing/metaclaw/openclaw_manager_overview.md)
- [`openclaw_manager_schemas.md`](/Users/yangshangqing/metaclaw/openclaw_manager_schemas.md)
- [`SKILL_DEVELOPMENT_STANDARD.md`](/Users/yangshangqing/metaclaw/SKILL_DEVELOPMENT_STANDARD.md)

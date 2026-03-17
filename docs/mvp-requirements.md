# OpenClaw Manager MVP Requirements

This file translates `openclaw_manager_overview.md` and `openclaw_manager_schemas.md` into concrete development requirements for the first implementation phase.

## Product Goal

OpenClaw Manager is not a chat UI enhancement. It is a control plane and state plane that upgrades OpenClaw from message flow management to task state management.

## Phase 1 Functional Requirements

### FR-01 Session as primary object

- The system must manage durable `session` objects instead of relying on raw chat history.
- Each session must store title, objective, owner, status, lifecycle stage, priority, tags, source channels, current structured state, and aggregate metrics.

### FR-02 Run lifecycle isolation

- Each execution attempt must be represented as a separate `run`.
- A failed run must not implicitly kill the parent session.
- The run state machine must at least support `accepted`, `queued`, `running`, `waiting_human`, `blocked`, `completed`, `failed`, `cancelled`, and `superseded`.

### FR-03 Event as fact base

- All important state transitions must produce normalized `event` records.
- Event logs must be append-only and per-run.
- Recovery, observability, and later distillation layers must depend on events rather than raw chat replay.

### FR-04 Filesystem-first durable state

- Runtime state must be written in JSON / JSONL / Markdown under a deterministic directory structure.
- The store must create and maintain session directories, run directories, index files, inbound inbox files, snapshot directories, and export directories.

### FR-05 Recovery surface

- Each active session must expose both a human-readable `summary.md` and a machine-oriented `checkpoint.json`.
- Resume flows must read checkpoint first and summary second.

### FR-06 Attention derivation

- The system must derive attention items from structured session state rather than from raw logs.
- Initial heuristics must cover waiting-human, blocked, stale, and desynced cases.

### FR-07 Local sharing

- The system must export read-only task snapshots with a manifest, summary, artifacts/traces placeholders, and a simple static HTML view.

### FR-08 Skill-facing command surface

- The manager skill must expose at least `/tasks`, `/resume`, `/share`, `/focus`, `/checkpoint`, `/close`, and `/adopt`.
- The command layer must act as a wrapper over the control plane rather than owning state itself.

### FR-09 Inbound normalization boundary

- The sidecar must accept normalized inbound messages through a single API contract.
- Connector-specific semantics must not leak into the control plane.

### FR-10 Capability and telemetry placeholders

- The scaffold must include `SkillTrace` and `CapabilityFact` contracts and append-only storage hooks, even if Phase 1 only emits minimal closure facts.

## Non-Functional Constraints

### NF-01 Simplicity first

- Use a lightweight Node.js sidecar with no heavy framework dependency in the initial version.

### NF-02 Deterministic storage

- Favor explicit files and indexes over hidden state.
- Keep the data layout inspectable and easy to back up.

### NF-03 Extensibility

- Keep modules separated by responsibility so Phase 2 connectors and Phase 3 distillation can be added without redesigning the store.

### NF-04 OpenClaw-native integration

- The system must be installable as a skill while still allowing a local sidecar and support files.

## Explicitly Deferred

- Real external connectors and polling logic
- SQLite indexes and advanced querying
- Multi-user permissions
- Rich frontend dashboard
- Cross-node public capability upload

## Implemented Repository Mapping

- Skill surface: [`skills/openclaw-manager/`](/Users/yangshangqing/metaclaw/skills/openclaw-manager)
- Sidecar and control plane: [`src/`](/Users/yangshangqing/metaclaw/src)
- JSON schemas: [`schemas/`](/Users/yangshangqing/metaclaw/schemas)
- Rendering templates: [`templates/`](/Users/yangshangqing/metaclaw/templates)

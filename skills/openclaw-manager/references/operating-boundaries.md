# Operating Boundaries

## Phase 1 Scope

- Filesystem-first state store
- Durable `session`, `run`, and `event` objects
- Basic attention derivation
- Snapshot export
- Minimal sidecar API

## Deferred

- Live Telegram / WeCom / email connectors
- SQLite query acceleration
- Rich dashboard UI
- Cross-node capability upload

## Guardrails

- Do not treat platform-specific thread semantics as core state.
- Do not overwrite append-only logs to "fix" history.
- Do not recover a session by replaying the entire chat when checkpoint plus summary are available.


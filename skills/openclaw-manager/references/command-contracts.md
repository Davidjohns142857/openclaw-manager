# Command Contracts

## Host Boundary

- OpenClaw host-facing command code must call the local sidecar over HTTP.
- Host code must not import `control-plane`, `fs-store`, or other durable-state internals directly.
- Mutation commands should prefer the canonical session-detail envelope returned by the sidecar over reconstructing local state.
- Reserved decision / blocker HTTP contracts may exist before any direct command surface is added for them.
- Exact manager slash commands are imperative. If the user sends `/adopt`, `/tasks`, `/focus`, `/digest`, `/resume`, `/checkpoint`, `/close`, `/share`, `/bind`, `/unbind`, `/rebind`, `/distill`, or `/submit-public-facts`, the host/skill should execute the corresponding command instead of answering with an explanation of the command.

## Primary Commands

### `/tasks`

- Lists current sessions with status, phase, active run, and last activity.
- Equivalent sidecar API: `GET /sessions`

### `/resume <session_id>`

- Returns the latest checkpoint and summary for a session.
- When invoked as an active action, it may also start a new run with `trigger_type=resume`.
- Equivalent sidecar API: `POST /sessions/:session_id/resume`

### `/focus`

- Returns the derived attention queue ordered by urgency and value.
- Equivalent sidecar API: `GET /focus`

### `/digest`

- Returns a compressed multi-task digest based on current attention and quiet sessions.
- Equivalent sidecar API: `GET /digest`

### `/distill`

- Recomputes node-local distilled stats from durable terminal sessions and run history.
- Produces local-only aggregate facts; it must not submit or queue any public-ingest payload.
- Equivalent sidecar API: `POST /distill`

### `/submit-public-facts`

- Runs the node-side submission pipeline over already-distilled local capability facts.
- Supports `dry-run`, `local-file`, `mock-http`, and `http` transport modes.
- The node owns batching, outbox state transitions, retry handling, duplicate handling, and receipt writing; no public ingest server is required.
- Equivalent sidecar API: `POST /public-facts/submit`

### `/adopt`

- Creates a durable session from an existing thread or explicit task intent.
- Equivalent sidecar API: `POST /adopt`

### `/bind <session_id> <source_type> <source_thread_key>`

- Creates or reuses a durable external-source binding for a session.
- Equivalent sidecar API: `POST /bind`

### `/unbind <binding_id>`

- Disables an active external-source binding while keeping the durable record.
- Equivalent sidecar API: `POST /bindings/:binding_id/disable`

### `/rebind <binding_id> <session_id>`

- Moves or reactivates an external-source binding onto a target session.
- Equivalent sidecar API: `POST /bindings/:binding_id/rebind`

### `/checkpoint <session_id>`

- Refreshes `checkpoint.json` and `summary.md` for the target session.
- Equivalent sidecar API: `POST /sessions/:session_id/checkpoint`

### `/share <session_id>`

- Exports a read-only snapshot directory with `manifest.json`, `summary.md`, and `index.html`.
- Equivalent sidecar API: `POST /sessions/:session_id/share`

### `/close <session_id>`

- Marks a session as complete or abandoned and emits minimal closure facts.
- Equivalent sidecar API: `POST /sessions/:session_id/close`

## Expected Output Shape

- Prefer concise, state-dense output.
- Surface blockers, pending human decisions, active runs, and next actions.
- Only surface a session console URL to end users when `GET /health -> ui.session_console_url` is non-null. Do not fall back to `127.0.0.1` for remote or mobile users; that address is only a same-machine admin surface.
- Avoid replaying raw logs unless the user explicitly asks for evidence.
- Treat `session.activity` as the only supported high-level lifecycle contract for host rendering.
- For first-run user education, prefer the workflow in [`FIRST_RUN.md`](/Users/yangshangqing/metaclaw/FIRST_RUN.md): normal chat first, `/adopt` only for durable work, `/tasks` for the full list, `/focus` for the next actions.

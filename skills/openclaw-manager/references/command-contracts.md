# Command Contracts

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

### `/adopt`

- Creates a durable session from an existing thread or explicit task intent.
- Equivalent sidecar API: `POST /adopt`

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
- Avoid replaying raw logs unless the user explicitly asks for evidence.


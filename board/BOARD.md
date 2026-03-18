# Viewer Board

Viewer Board is a public, read-only board server for per-user session visibility.

It runs separately from the manager sidecar and from public ingest:

- Manager sidecar: local-only control plane
- Public ingest: fact submission only
- Viewer Board: token-gated, read-only session board backed by pushed snapshots

Primary entrypoints:

- `node board/serve.ts`
- `GET /board/:token/`
- `GET /board-api/:token/*`
- `POST /board-sync/:token`
- `POST /admin/tokens`

Primary environment variables:

- `BOARD_PORT=18991`
- `BOARD_BIND_HOST=0.0.0.0`
- `BOARD_DATA_DIR=/var/lib/openclaw-board`
- `BOARD_ADMIN_SECRET=<strong secret>`

Board service no longer proxies a sidecar directly. Each local sidecar pushes:

- `sessions`
- `focus`
- `session_details`
- `session_timelines`

to `POST /board-sync/:token`, and the board reads the latest snapshot from local storage.

The full implementation contracts live in:

- [BOARD_IMPL_SPEC.md](/Users/yangshangqing/metaclaw/board/BOARD_IMPL_SPEC.md)
- [BOARD_PUSH_ARCHITECTURE.md](/Users/yangshangqing/metaclaw/board/BOARD_PUSH_ARCHITECTURE.md)

# Viewer Board

Viewer Board is a public, read-only board server for per-user session visibility.

It runs separately from the manager sidecar and from public ingest:

- Manager sidecar: local-only control plane
- Public ingest: fact submission only
- Viewer Board: token-gated, read-only session board

Primary entrypoints:

- `node board/serve.ts`
- `GET /board/:token/`
- `GET /board-api/:token/*`
- `POST /admin/tokens`

Primary environment variables:

- `BOARD_PORT=18991`
- `BOARD_BIND_HOST=0.0.0.0`
- `BOARD_SIDECAR_ORIGIN=http://127.0.0.1:18891`
- `BOARD_DATA_DIR=/var/lib/openclaw-board`
- `BOARD_ADMIN_SECRET=<strong secret>`

The full implementation contract lives in [BOARD_IMPL_SPEC.md](/Users/yangshangqing/metaclaw/board/BOARD_IMPL_SPEC.md).

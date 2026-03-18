# Viewer Board Setup Checklist

This is the shortest reliable path to make a user's mobile-visible board work.

Target result:

- local sidecar keeps running on `127.0.0.1:8791`
- public ingest stays on `http://142.171.114.18:56557/v1/ingest`
- remote/mobile users open:
  - `http://142.171.114.18:18991/board/<token>/`

Do not use:

- `http://127.0.0.1:8791/ui`
- `http://142.171.114.18:18891/ui`
- `http://142.171.114.18:56557/v1/ingest`

## 1. Preconditions

You need all of these before the board can work:

- the VPS board service is running on `18991`
- you know `BOARD_ADMIN_SECRET`
- the local OpenClaw Manager sidecar is installed
- public facts endpoint is still `http://142.171.114.18:56557/v1/ingest`

## 2. Normal Path: Automatic Self-Registration

For a normal user install, the preferred path is now:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts \
  --cloud-hosted \
  --enable-public-facts
```

That setup flow will:

- generate `board-identity.json`
- call `POST /register`
- receive or reuse a token
- write `board-config.json`
- let future sidecar launches auto-load that file and begin pushing

If you are manually administering a board, the next section is still available.

## 3. Manual Path: Create a Board Token on the VPS

Run this on the VPS itself, or through SSH:

```bash
curl -X POST http://127.0.0.1:18991/admin/tokens \
  -H "Authorization: Bearer $BOARD_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"owner_ref":"user_primary","label":"primary board"}'
```

Expected response:

```json
{
  "token": "bt_xxx",
  "board_url": "http://142.171.114.18:18991/board/bt_xxx/",
  "owner_ref": "user_primary"
}
```

Save the `token`. That is the only value you need for local setup.

## 4. Configure the Local OpenClaw Sidecar

On the same machine where OpenClaw and the sidecar run, execute:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts \
  --cloud-hosted \
  --enable-public-facts \
  --board-token bt_xxx
```

What this does:

- keeps Cloud/manual mode for chat
- keeps sidecar local-only
- enables public-facts auto submit
- enables board sync
- derives the push URL automatically as:
  - `http://142.171.114.18:18991/board-sync/bt_xxx`
- derives the user-facing board URL automatically as:
  - `http://142.171.114.18:18991/board/bt_xxx/`

If you need to override the board push URL explicitly:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts \
  --cloud-hosted \
  --enable-public-facts \
  --board-token bt_xxx \
  --board-push-url http://142.171.114.18:18991/board-sync/bt_xxx
```

## 5. Verify Local Configuration

Run:

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/doctor-local-chain.ts
```

You should see:

- `Board sync enabled: true`
- `Board push URL: http://142.171.114.18:18991/board-sync/bt_xxx`
- `Viewer board URL: http://142.171.114.18:18991/board/bt_xxx/`

Also check:

```bash
curl -s http://127.0.0.1:8791/health
```

Expected fields:

- `ui.session_console_url = "http://142.171.114.18:18991/board/bt_xxx/"`
- `ui.viewer_board_url = "http://142.171.114.18:18991/board/bt_xxx/"`
- `ui.local_session_console_url = "http://127.0.0.1:8791/ui"`
- `ui.board_sync.enabled = true`

If `ui.session_console_url` is still `null`, local setup did not pick up the token.

## 6. Force a First Snapshot

The board stays empty until the local sidecar pushes a snapshot.

The simplest way to force this is:

1. open OpenClaw
2. create or continue a durable task
3. run `/adopt` if the task is not yet durable
4. run `/tasks`
5. optionally run `/checkpoint`

Mutation paths trigger an extra push immediately, and there is also a background push every 15 seconds.

## 7. Verify the Remote Board

Open the user-facing board:

- `http://142.171.114.18:18991/board/bt_xxx/`

Optional API verification:

```bash
curl -s http://142.171.114.18:18991/board-api/bt_xxx/health
curl -s http://142.171.114.18:18991/board-api/bt_xxx/sessions
```

Expected:

- `health.online = true`
- `health.session_count > 0` after you adopt at least one task
- `sessions` contains the same durable sessions that `/tasks` shows in chat

## 8. If `/tasks` Works but the Board Is Still Empty

This is the most common failure mode.

Check in this order:

1. Wrong token
   - local config may be pushing to `bt_old`
   - but you are opening `bt_new`

2. Board sync not enabled
   - `doctor-local-chain.ts` should show `Board sync enabled: true`

3. Sidecar did not restart with the new config
   - rerun setup
   - then run doctor again

4. No mutation happened after setup
   - run `/adopt`, `/checkpoint`, or `/close`
   - wait 15 seconds

5. Snapshot is arriving for a different machine/user
   - compare `board-api/<token>/health`
   - check `snapshot_at` and `session_count`

## 9. If the Board Page Is Blank White

Check:

```bash
curl -i http://142.171.114.18:18991/board/bt_xxx/
curl -s http://142.171.114.18:18991/board-api/bt_xxx/health
```

Interpretation:

- HTML loads, but `session_count = 0`
  - board server is fine
  - snapshot is missing or wrong token is being used

- board API returns `403`
  - token is invalid, revoked, or expired

- board API returns `404`
  - wrong path; use `/board/<token>/` and `/board-api/<token>/...`

- board API is unreachable
  - board service on `18991` is not running or not reachable

## 10. What to Give the User

Once the above is green, the correct user-facing link is:

- `http://142.171.114.18:18991/board/bt_xxx/`

Do not give the user:

- `http://127.0.0.1:8791/ui`
- `http://142.171.114.18:18891/ui`
- `http://142.171.114.18:56557/v1/ingest`

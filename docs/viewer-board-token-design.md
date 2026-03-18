# Viewer Board Token Design

This document defines the preferred design for a user-facing remote session board in Cloud / hosted OpenClaw environments.

## Goal

Allow each end user to open a clean, remote, read-only board that shows only their own `session` / `run` state, even when OpenClaw itself is hosted.

## Recommendation

Use:

- one fixed published board origin or port
- one opaque per-user board token

Example:

- `http://142.171.114.18:18991/board/bt_7QqA8w...`

Do not use:

- one random port per user

## Why Token Paths Beat Per-User Ports

Per-user ports are the wrong abstraction for this product:

- ports are operationally expensive
- firewall and reverse-proxy rules become messy
- TLS and routing are harder
- revocation is awkward
- “this link belongs to this user” is not naturally modeled by a port

Opaque board tokens are better because they support:

- user-level isolation
- revocation
- rotation
- expiry
- logging and auditing
- one stable public UI service

## Architecture

Recommended public shape:

- public board origin: `http://142.171.114.18:18991`
- route shape: `/board/:viewer_token`
- optional JSON API shape: `/board-api/:viewer_token/...`

Data sources remain separated:

- manager sidecar: private
- public ingest: separate service on `56557`
- board server: separate public read-only surface

The board server must not reuse:

- raw sidecar port
- ingest `host:port`

## Token Contract

A `viewer_token` must be:

- opaque
- high entropy
- non-guessable
- revocable

Suggested properties:

- 128-bit or stronger random value
- base64url or hex encoded
- prefixed for debugging, e.g. `bt_...`

## Token Scope

Each token should map to exactly one viewer scope.

Minimum scope options:

1. one user
2. one user + one workspace
3. one user + one tenant

Recommended first version:

- one token maps to one `owner_ref.ref`

This means every board request gets filtered by the owning user before any session data is returned.

## Read Surface

The published board should be read-only.

Allowed:

- session list
- focus list
- session detail
- run timeline
- human-readable summary

Not allowed:

- `/adopt`
- `/resume`
- `/checkpoint`
- `/close`
- direct sidecar mutation routes

Mutations remain in chat.

## Data Filtering

Every board response must be filtered by token scope before serialization.

At minimum:

- only sessions owned by the token’s user are visible
- only runs under those sessions are visible
- only focus items for those sessions are visible

No cross-user global list should be visible from the public board.

## Freshness Model

The board does not need real-time push first.

Recommended minimum:

- polling every 5–15 seconds

Optional later:

- SSE or websocket push

The important rule is:

- only the token’s own filtered data is delivered to that board

## Lifecycle

Viewer tokens need lifecycle controls:

- create
- list
- revoke
- rotate
- expire

Recommended first version:

- one active board token per user
- manual rotation supported
- immediate revocation supported

## Privacy Rules

The public board should expose only safe, user-owned read data.

It should not expose:

- raw filesystem paths
- internal local admin URLs
- unrelated users’ sessions
- public-fact outbox internals unless explicitly desired

## Operational Shape

Preferred deployment:

- one public board service on `18991`
- reverse proxy optional
- board tokens embedded in links sent to users

Example final user link:

- `http://142.171.114.18:18991/board/bt_f4J9x...`

## Product Consequence

This design matches the product better than per-user ports:

- users get a clean personal board
- the UI can be polished without forcing chat output to carry all status
- chat remains the mutation/control surface
- hosting remains tractable

## Phase Plan

Phase A:

- fixed public board port
- per-user opaque viewer token
- read-only session/focus/detail/timeline pages
- filtered polling API

Phase B:

- token management UI / commands
- expiry / rotation / revoke
- prettier personalized board

Phase C:

- SSE push
- richer user-scoped evidence and digest views

## Non-Goals

This design does not require:

- one port per user
- exposing the raw manager sidecar publicly
- reusing the ingest service
- moving manager mutations out of chat

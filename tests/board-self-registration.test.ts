import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";

import {
  readBoardConfig,
  resolveBoardSyncConfigFromStateRoot,
  writeBoardConfig
} from "../src/board/board-config.ts";
import { getOrCreateIdentity, signTimestamp } from "../src/board/identity.ts";
import { bootstrapManager } from "../src/skill/bootstrap.ts";
import {
  RegistrationRateLimiter,
  validateRegistrationRequest
} from "../board/registration.ts";

test("board identity is stable and derived from shared node secret", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-board-identity-"));

  try {
    const first = await getOrCreateIdentity(tempDir);
    const second = await getOrCreateIdentity(tempDir);

    assert.equal(first.owner_ref, second.owner_ref);
    assert.equal(first.node_id, second.node_id);
    assert.equal(first.node_secret, second.node_secret);
    assert.match(first.owner_ref, /^user_[a-f0-9]{16}$/u);
    assert.match(first.node_id, /^anon_[a-f0-9]{32}$/u);
    assert.match(signTimestamp(first.node_secret, "2026-03-18T12:00:00.000Z"), /^[a-f0-9]{64}$/u);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("board sync config resolves from board-config.json when env config is absent", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-board-config-"));

  try {
    await writeBoardConfig(tempDir, {
      board_token: "bt_demo",
      board_url: "http://142.171.114.18:18991/board/bt_demo/",
      push_url: "http://142.171.114.18:18991/board-sync/bt_demo",
      owner_ref: "user_demo",
      registered_at: "2026-03-18T12:00:00.000Z"
    });

    const persisted = await readBoardConfig(tempDir);
    assert.equal(persisted?.board_token, "bt_demo");

    const resolved = await resolveBoardSyncConfigFromStateRoot(tempDir, {
      enabled: false,
      board_token: null,
      board_push_url: null,
      push_interval_ms: 15000,
      push_on_mutation: true,
      timeout_ms: 5000
    });

    assert.equal(resolved.enabled, true);
    assert.equal(resolved.board_token, "bt_demo");
    assert.equal(resolved.board_push_url, "http://142.171.114.18:18991/board-sync/bt_demo");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("bootstrapManager auto-loads board-config.json and starts board sync without env vars", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-board-bootstrap-"));
  const originalFetch = globalThis.fetch;
  const pushedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    pushedUrls.push(url);
    return new Response(JSON.stringify({ status: "accepted" }), {
      status: 202,
      headers: {
        "content-type": "application/json"
      }
    });
  }) as typeof globalThis.fetch;

  try {
    await writeBoardConfig(tempDir, {
      board_token: "bt_bootstrap",
      board_url: "http://142.171.114.18:18991/board/bt_bootstrap/",
      push_url: "http://142.171.114.18:18991/board-sync/bt_bootstrap",
      owner_ref: "user_demo",
      registered_at: "2026-03-18T12:00:00.000Z"
    });

    const boot = await bootstrapManager({
      stateRoot: tempDir,
      public_facts: {
        endpoint: "http://142.171.114.18:56557/v1/ingest",
        auth_token: null,
        schema_version: "1.0.0",
        timeout_ms: 5000,
        auto_submit_enabled: false,
        auto_submit_interval_ms: 300000,
        auto_submit_startup_delay_ms: 15000,
        auto_submit_max_batch_size: 50,
        auto_submit_max_batches: 10,
        auto_submit_retry_failed_retryable: true
      },
      board_sync: {
        enabled: false,
        board_token: null,
        board_push_url: null,
        push_interval_ms: 15000,
        push_on_mutation: true,
        timeout_ms: 5000
      }
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.equal(boot.config.board_sync.enabled, true);
      assert.equal(boot.config.board_sync.board_token, "bt_bootstrap");
      assert.equal(
        boot.config.board_sync.board_push_url,
        "http://142.171.114.18:18991/board-sync/bt_bootstrap"
      );
      assert.deepEqual(pushedUrls, ["http://142.171.114.18:18991/board-sync/bt_bootstrap"]);
    } finally {
      boot.boardSyncService.stop();
      boot.publicFactAutoSubmitService.stop();
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("bootstrapManager skips board sync cleanly when board-config.json is absent", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-board-no-config-"));
  const originalFetch = globalThis.fetch;
  const pushedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    pushedUrls.push(url);
    return new Response(JSON.stringify({ status: "accepted" }), {
      status: 202,
      headers: {
        "content-type": "application/json"
      }
    });
  }) as typeof globalThis.fetch;

  try {
    const boot = await bootstrapManager({
      stateRoot: tempDir,
      public_facts: {
        endpoint: "http://142.171.114.18:56557/v1/ingest",
        auth_token: null,
        schema_version: "1.0.0",
        timeout_ms: 5000,
        auto_submit_enabled: false,
        auto_submit_interval_ms: 300000,
        auto_submit_startup_delay_ms: 15000,
        auto_submit_max_batch_size: 50,
        auto_submit_max_batches: 10,
        auto_submit_retry_failed_retryable: true
      },
      board_sync: {
        enabled: false,
        board_token: null,
        board_push_url: null,
        push_interval_ms: 15000,
        push_on_mutation: true,
        timeout_ms: 5000
      }
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(boot.config.board_sync.enabled, false);
      assert.equal(boot.config.board_sync.board_token, null);
      assert.equal(boot.config.board_sync.board_push_url, null);
      assert.deepEqual(pushedUrls, []);
    } finally {
      boot.boardSyncService.stop();
      boot.publicFactAutoSubmitService.stop();
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("registration proof validation and rate limit enforce lightweight self-registration rules", () => {
  const timestamp = new Date().toISOString();
  const validError = validateRegistrationRequest("user_demo", {
    sidecar_version: "0.1.0",
    node_id: "anon_1234567890abcdef1234567890abcdef",
    timestamp,
    signature: "abcdef1234567890abcdef1234567890"
  });

  assert.equal(validError, null);
  assert.equal(
    validateRegistrationRequest("u", {
      sidecar_version: "0.1.0",
      node_id: "anon_1234567890abcdef1234567890abcdef",
      timestamp,
      signature: "abcdef1234567890abcdef1234567890"
    }),
    "invalid_owner_ref"
  );
  assert.equal(
    validateRegistrationRequest("user_demo", {
      sidecar_version: "0.1.0",
      node_id: "bad_node_id",
      timestamp,
      signature: "abcdef1234567890abcdef1234567890"
    }),
    "invalid_install_proof"
  );
  assert.equal(
    validateRegistrationRequest("user_demo", {
      sidecar_version: "0.1.0",
      node_id: "anon_1234567890abcdef1234567890abcdef",
      timestamp: "2000-01-01T00:00:00.000Z",
      signature: "abcdef1234567890abcdef1234567890"
    }),
    "timestamp_too_old"
  );

  const limiter = new RegistrationRateLimiter(3, 3_600_000);
  assert.equal(limiter.tryConsume("1.2.3.4", 0), true);
  assert.equal(limiter.tryConsume("1.2.3.4", 1), true);
  assert.equal(limiter.tryConsume("1.2.3.4", 2), true);
  assert.equal(limiter.tryConsume("1.2.3.4", 3), false);
  assert.equal(limiter.tryConsume("1.2.3.4", 3_600_001), true);
});

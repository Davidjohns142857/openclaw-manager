import assert from "node:assert/strict";
import { test } from "node:test";

import { PublishedUiServer } from "../src/api/published-ui-server.ts";
import { createTempManager, dispatchRawRoute, dispatchRoute } from "./helpers.ts";

test("published ui proxy serves a mobile-shareable read-only console on a dedicated port", async () => {
  const manager = await createTempManager({
    port: 9911,
    ui: {
      public_base_url: "http://142.171.114.18:18891",
      publish_port: 18891,
      publish_bind_host: "0.0.0.0"
    }
  });

  try {
    const server = new PublishedUiServer(
      manager.controlPlane,
      manager.config,
      manager.publicFactAutoSubmitService
    );
    const healthResponse = await dispatchRoute(server, "GET", "/health");
    assert.equal(healthResponse.statusCode, 200);
    const health = healthResponse.body as {
      state_root?: string;
      server_role?: string;
      port?: number;
      ui?: {
        access_mode?: string;
        read_only?: boolean;
        session_console_url?: string | null;
        local_session_console_url?: string;
        publish_proxy?: {
          enabled?: boolean;
          bind_host?: string;
          port?: number | null;
        };
      };
    };

    assert.equal(health.state_root, undefined);
    assert.equal(health.server_role, "published_ui_proxy");
    assert.equal(health.port, 9911);
    assert.equal(health.ui?.access_mode, "published_proxy");
    assert.equal(health.ui?.read_only, true);
    assert.equal(health.ui?.session_console_url, "http://142.171.114.18:18891/ui");
    assert.equal(health.ui?.local_session_console_url, "http://127.0.0.1:9911/ui");
    assert.equal(health.ui?.publish_proxy?.enabled, true);
    assert.equal(health.ui?.publish_proxy?.bind_host, "0.0.0.0");
    assert.equal(health.ui?.publish_proxy?.port, 18891);

    const uiResponse = await dispatchRawRoute(server, "GET", "/ui");
    assert.equal(uiResponse.statusCode, 200);
    assert.match(String(uiResponse.headers["content-type"] ?? ""), /text\/html/);
    assert.match(uiResponse.bodyText, /OpenClaw Session Console/);
  } finally {
    await manager.cleanup();
  }
});

test("published ui proxy allows read routes but rejects control-plane mutations", async () => {
  const manager = await createTempManager({
    port: 9911,
    ui: {
      public_base_url: "http://142.171.114.18:18892",
      publish_port: 18892,
      publish_bind_host: "0.0.0.0"
    }
  });

  try {
    const server = new PublishedUiServer(
      manager.controlPlane,
      manager.config,
      manager.publicFactAutoSubmitService
    );
    const adopted = await manager.controlPlane.adoptSession({
      title: "Published UI Session",
      objective: "Verify read-only console routing."
    });
    await manager.controlPlane.resumeSession(adopted.session.session_id);

    const sessionsResponse = await dispatchRoute(server, "GET", "/sessions");
    assert.equal(sessionsResponse.statusCode, 200);
    const sessions = sessionsResponse.body as Array<{ session_id: string }>;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.session_id, adopted.session.session_id);

    const detailResponse = await dispatchRoute(
      server,
      "GET",
      `/sessions/${encodeURIComponent(adopted.session.session_id)}`
    );
    assert.equal(detailResponse.statusCode, 200);
    const detail = detailResponse.body as {
      session: { session_id: string };
    };
    assert.equal(detail.session.session_id, adopted.session.session_id);

    const timelineResponse = await dispatchRoute(
      server,
      "GET",
      `/sessions/${encodeURIComponent(adopted.session.session_id)}/timeline`
    );
    assert.equal(timelineResponse.statusCode, 200);
    const timeline = timelineResponse.body as {
      run_count: number;
    };
    assert.ok(timeline.run_count >= 1);

    const outboxResponse = await dispatchRoute(server, "GET", "/public-facts/outbox");
    assert.equal(outboxResponse.statusCode, 200);

    const resumeResponse = await dispatchRawRoute(
      server,
      "POST",
      `/sessions/${encodeURIComponent(adopted.session.session_id)}/resume`,
      {}
    );
    assert.equal(resumeResponse.statusCode, 405);
    assert.match(resumeResponse.bodyText, /read-only/i);

    const submitResponse = await dispatchRawRoute(server, "POST", "/public-facts/submit", {
      mode: "http"
    });
    assert.equal(submitResponse.statusCode, 405);
    assert.match(submitResponse.bodyText, /read-only/i);
  } finally {
    await manager.cleanup();
  }
});

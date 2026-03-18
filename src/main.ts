import { ManagerServer } from "./api/server.ts";
import { PublishedUiServer } from "./api/published-ui-server.ts";
import { bootstrapManager } from "./skill/bootstrap.ts";

function maskBoardPushUrl(url: string | null): string {
  if (!url) {
    return "unconfigured";
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      segments[segments.length - 1] = "<token>";
      parsed.pathname = `/${segments.join("/")}`;
    }
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}

try {
  const { controlPlane, config, publicFactAutoSubmitService, boardSyncService } =
    await bootstrapManager();
  const server = new ManagerServer(controlPlane, config, publicFactAutoSubmitService);
  const publishedUiServer =
    config.ui.publish_port !== null
      ? new PublishedUiServer(controlPlane, config, publicFactAutoSubmitService)
      : null;

  await server.start();
  if (publishedUiServer) {
    await publishedUiServer.start();
  }

  const shutdown = async () => {
    boardSyncService.stop();
    publicFactAutoSubmitService.stop();
    if (publishedUiServer) {
      await publishedUiServer.stop();
    }
    await server.stop();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  console.log(`OpenClaw Manager sidecar listening on http://127.0.0.1:${config.port}`);
  if (publishedUiServer) {
    const address = publishedUiServer.server.address();
    const publishedPort =
      address && typeof address !== "string" ? address.port : config.ui.publish_port;
    console.log(
      `Published read-only UI proxy listening on http://${config.ui.publish_bind_host}:${publishedPort}`
    );
  }
  console.log(`State root: ${config.stateRoot}`);
  console.log(`Public facts endpoint: ${config.public_facts.endpoint}`);
  console.log(
    `Public facts auto submit: ${
      config.public_facts.auto_submit_enabled
        ? `enabled every ${config.public_facts.auto_submit_interval_ms}ms`
        : "disabled"
    }`
  );
  console.log(
    `Board sync: ${
      config.board_sync.enabled
        ? `enabled -> ${maskBoardPushUrl(config.board_sync.board_push_url)} every ${config.board_sync.push_interval_ms}ms`
        : "disabled"
    }`
  );
} catch (error) {
  console.error(
    `OpenClaw Manager failed to start: ${
      error instanceof Error ? error.message : "unknown error"
    }`
  );
  process.exitCode = 1;
}

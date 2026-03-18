import { ManagerServer } from "./api/server.ts";
import { PublishedUiServer } from "./api/published-ui-server.ts";
import { bootstrapManager } from "./skill/bootstrap.ts";

try {
  const { controlPlane, config, publicFactAutoSubmitService } = await bootstrapManager();
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
} catch (error) {
  console.error(
    `OpenClaw Manager failed to start: ${
      error instanceof Error ? error.message : "unknown error"
    }`
  );
  process.exitCode = 1;
}

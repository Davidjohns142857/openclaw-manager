import { ManagerServer } from "./api/server.ts";
import { bootstrapManager } from "./skill/bootstrap.ts";

try {
  const { controlPlane, config } = await bootstrapManager();
  const server = new ManagerServer(controlPlane, config);

  await server.start();

  console.log(`OpenClaw Manager sidecar listening on http://127.0.0.1:${config.port}`);
  console.log(`State root: ${config.stateRoot}`);
} catch (error) {
  console.error(
    `OpenClaw Manager failed to start: ${
      error instanceof Error ? error.message : "unknown error"
    }`
  );
  process.exitCode = 1;
}

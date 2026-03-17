import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ManagerConfig } from "./shared/types.ts";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(srcDir, "..");

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ManagerConfig {
  const port = Number.parseInt(env.OPENCLAW_MANAGER_PORT ?? "8791", 10);

  return {
    repoRoot,
    stateRoot: env.OPENCLAW_MANAGER_HOME ?? path.join(repoRoot, ".openclaw-manager-state"),
    templatesDir: path.join(repoRoot, "templates"),
    schemasDir: path.join(repoRoot, "schemas"),
    port: Number.isFinite(port) ? port : 8791
  };
}


import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ManagerConfig } from "./shared/types.ts";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(srcDir, "..");

function parseBooleanFlag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "TRUE" || value === "yes";
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ManagerConfig {
  const port = Number.parseInt(env.OPENCLAW_MANAGER_PORT ?? "8791", 10);

  return {
    repoRoot,
    stateRoot: env.OPENCLAW_MANAGER_HOME ?? path.join(repoRoot, ".openclaw-manager-state"),
    templatesDir: path.join(repoRoot, "templates"),
    schemasDir: path.join(repoRoot, "schemas"),
    port: Number.isFinite(port) ? port : 8791,
    features: {
      decision_lifecycle_v1: parseBooleanFlag(
        env.OPENCLAW_MANAGER_FEATURE_DECISION_LIFECYCLE_V1
      ),
      blocker_lifecycle_v1: parseBooleanFlag(env.OPENCLAW_MANAGER_FEATURE_BLOCKER_LIFECYCLE_V1)
    }
  };
}

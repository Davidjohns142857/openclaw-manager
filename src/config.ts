import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ManagerConfig } from "./shared/types.ts";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(srcDir, "..");

function parseBooleanFlag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "TRUE" || value === "yes";
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ManagerConfig {
  const port = parseInteger(env.OPENCLAW_MANAGER_PORT, 8791);

  return {
    repoRoot,
    stateRoot: env.OPENCLAW_MANAGER_HOME ?? path.join(repoRoot, ".openclaw-manager-state"),
    templatesDir: path.join(repoRoot, "templates"),
    schemasDir: path.join(repoRoot, "schemas"),
    port,
    features: {
      decision_lifecycle_v1: parseBooleanFlag(
        env.OPENCLAW_MANAGER_FEATURE_DECISION_LIFECYCLE_V1
      ),
      blocker_lifecycle_v1: parseBooleanFlag(env.OPENCLAW_MANAGER_FEATURE_BLOCKER_LIFECYCLE_V1)
    },
    public_facts: {
      endpoint:
        env.OPENCLAW_MANAGER_PUBLIC_FACTS_ENDPOINT?.trim() ||
        "http://142.171.114.18/v1/ingest",
      timeout_ms: parseInteger(env.OPENCLAW_MANAGER_PUBLIC_FACTS_TIMEOUT_MS, 10000),
      auth_token: env.OPENCLAW_MANAGER_PUBLIC_FACTS_AUTH_TOKEN?.trim() || null,
      schema_version: env.OPENCLAW_MANAGER_PUBLIC_FACTS_SCHEMA_VERSION?.trim() || "1.0.0"
    }
  };
}

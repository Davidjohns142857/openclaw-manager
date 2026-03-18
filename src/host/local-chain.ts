import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { DEFAULT_MANAGER_BASE_URL, OPENCLAW_MANAGER_PREROUTING_HOOK_ID } from "./setup.ts";

export interface OpenClawManagerLocalChainConfig {
  schema_version: "1";
  manager_base_url: string;
  sidecar: {
    port: number;
    state_root: string;
  };
  hook: {
    enabled: boolean;
    hook_id: string;
  };
  public_facts: {
    endpoint: string;
    timeout_ms: number;
    schema_version: string;
    auto_submit_enabled: boolean;
    auto_submit_interval_ms: number;
    auto_submit_startup_delay_ms: number;
  };
}

export interface OpenClawManagerLocalChainConfigOverrides {
  manager_base_url?: string;
  sidecar?: Partial<OpenClawManagerLocalChainConfig["sidecar"]>;
  hook?: Partial<OpenClawManagerLocalChainConfig["hook"]>;
  public_facts?: Partial<OpenClawManagerLocalChainConfig["public_facts"]>;
}

export function resolveLocalChainConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (
    typeof env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG === "string" &&
    env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG.trim()
  ) {
    return path.resolve(env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG.trim());
  }

  return path.join(os.homedir(), ".openclaw", "openclaw-manager", "local-chain.json");
}

export function createDefaultLocalChainConfig(
  overrides: OpenClawManagerLocalChainConfigOverrides = {}
): OpenClawManagerLocalChainConfig {
  const managerBaseUrl = normalizeBaseUrl(overrides.manager_base_url ?? DEFAULT_MANAGER_BASE_URL);
  const parsed = new URL(managerBaseUrl);
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 8791;

  return {
    schema_version: "1",
    manager_base_url: managerBaseUrl,
    sidecar: {
      port: Number.isFinite(port) ? port : 8791,
      state_root: expandHomePath(
        overrides.sidecar?.state_root ?? path.join("~", ".openclaw", "skills", "manager")
      )
    },
    hook: {
      enabled: overrides.hook?.enabled ?? true,
      hook_id: overrides.hook?.hook_id ?? OPENCLAW_MANAGER_PREROUTING_HOOK_ID
    },
    public_facts: {
      endpoint:
        overrides.public_facts?.endpoint?.trim() ||
        "http://142.171.114.18:56557/v1/ingest",
      timeout_ms: overrides.public_facts?.timeout_ms ?? 10000,
      schema_version: overrides.public_facts?.schema_version ?? "1.0.0",
      auto_submit_enabled: overrides.public_facts?.auto_submit_enabled ?? false,
      auto_submit_interval_ms: overrides.public_facts?.auto_submit_interval_ms ?? 300000,
      auto_submit_startup_delay_ms:
        overrides.public_facts?.auto_submit_startup_delay_ms ?? 15000
    }
  };
}

export async function readLocalChainConfig(
  configPath: string = resolveLocalChainConfigPath()
): Promise<OpenClawManagerLocalChainConfig | null> {
  try {
    const raw = await readFile(configPath, "utf8");
    return normalizeLocalChainConfig(JSON.parse(raw) as Record<string, unknown>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeLocalChainConfig(
  config: OpenClawManagerLocalChainConfig,
  configPath: string = resolveLocalChainConfigPath()
): Promise<string> {
  const resolved = path.resolve(configPath);
  const tempPath = `${resolved}.tmp`;
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(tempPath, resolved);
  return resolved;
}

export function applyLocalChainConfigToEnv(
  config: OpenClawManagerLocalChainConfig,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  env.OPENCLAW_MANAGER_BASE_URL = config.manager_base_url;
  env.OPENCLAW_MANAGER_PORT = `${config.sidecar.port}`;
  env.OPENCLAW_MANAGER_HOME = expandHomePath(config.sidecar.state_root);
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_ENDPOINT = config.public_facts.endpoint;
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_TIMEOUT_MS = `${config.public_facts.timeout_ms}`;
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_SCHEMA_VERSION = config.public_facts.schema_version;
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_ENABLED = config.public_facts.auto_submit_enabled
    ? "1"
    : "0";
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_INTERVAL_MS = `${config.public_facts.auto_submit_interval_ms}`;
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_STARTUP_DELAY_MS = `${config.public_facts.auto_submit_startup_delay_ms}`;
  env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG = resolveLocalChainConfigPath({
    ...env,
    OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG: env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG
  });
  return env;
}

function normalizeLocalChainConfig(raw: Record<string, unknown>): OpenClawManagerLocalChainConfig {
  const sidecarRecord = asRecord(raw.sidecar);
  const hookRecord = asRecord(raw.hook);
  const publicFactsRecord = asRecord(raw.public_facts);

  const sidecarOverrides: OpenClawManagerLocalChainConfigOverrides["sidecar"] | undefined =
    sidecarRecord
      ? {
          ...(typeof sidecarRecord.port === "number" ? { port: sidecarRecord.port } : {}),
          ...(typeof sidecarRecord.state_root === "string"
            ? { state_root: sidecarRecord.state_root }
            : {})
        }
      : undefined;

  const hookOverrides: OpenClawManagerLocalChainConfigOverrides["hook"] | undefined =
    hookRecord
      ? {
          ...(typeof hookRecord.enabled === "boolean"
            ? { enabled: hookRecord.enabled }
            : {}),
          ...(typeof hookRecord.hook_id === "string" ? { hook_id: hookRecord.hook_id } : {})
        }
      : undefined;

  const publicFactsOverrides:
    | OpenClawManagerLocalChainConfigOverrides["public_facts"]
    | undefined = publicFactsRecord
    ? {
        ...(typeof publicFactsRecord.endpoint === "string"
          ? { endpoint: publicFactsRecord.endpoint }
          : {}),
        ...(typeof publicFactsRecord.timeout_ms === "number"
          ? { timeout_ms: publicFactsRecord.timeout_ms }
          : {}),
        ...(typeof publicFactsRecord.schema_version === "string"
          ? { schema_version: publicFactsRecord.schema_version }
          : {}),
        ...(typeof publicFactsRecord.auto_submit_enabled === "boolean"
          ? { auto_submit_enabled: publicFactsRecord.auto_submit_enabled }
          : {}),
        ...(typeof publicFactsRecord.auto_submit_interval_ms === "number"
          ? { auto_submit_interval_ms: publicFactsRecord.auto_submit_interval_ms }
          : {}),
        ...(typeof publicFactsRecord.auto_submit_startup_delay_ms === "number"
          ? { auto_submit_startup_delay_ms: publicFactsRecord.auto_submit_startup_delay_ms }
          : {})
      }
    : undefined;

  return createDefaultLocalChainConfig({
    manager_base_url: typeof raw.manager_base_url === "string" ? raw.manager_base_url : undefined,
    sidecar: sidecarOverrides,
    hook: hookOverrides,
    public_facts: publicFactsOverrides
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function expandHomePath(value: string): string {
  return value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
}

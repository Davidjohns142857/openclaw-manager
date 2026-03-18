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
  ui: {
    public_base_url: string | null;
    publish_port: number | null;
    publish_bind_host: string;
  };
  hook: {
    enabled: boolean;
    hook_id: string;
  };
  host_integration: {
    mode: "managed_hook" | "manual_adopt";
    reason: string | null;
  };
  public_facts: {
    endpoint: string;
    timeout_ms: number;
    schema_version: string;
    auto_submit_enabled: boolean;
    auto_submit_interval_ms: number;
    auto_submit_startup_delay_ms: number;
  };
  board_sync: {
    enabled: boolean;
    token: string | null;
    push_url: string | null;
    push_interval_ms: number;
    push_on_mutation: boolean;
    timeout_ms: number;
  };
}

export interface OpenClawManagerLocalChainConfigOverrides {
  manager_base_url?: string;
  sidecar?: Partial<OpenClawManagerLocalChainConfig["sidecar"]>;
  ui?: Partial<OpenClawManagerLocalChainConfig["ui"]>;
  hook?: Partial<OpenClawManagerLocalChainConfig["hook"]>;
  host_integration?: Partial<OpenClawManagerLocalChainConfig["host_integration"]>;
  public_facts?: Partial<OpenClawManagerLocalChainConfig["public_facts"]>;
  board_sync?: Partial<OpenClawManagerLocalChainConfig["board_sync"]>;
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
    ui: {
      public_base_url: normalizeOptionalBaseUrl(overrides.ui?.public_base_url),
      publish_port:
        typeof overrides.ui?.publish_port === "number" &&
        Number.isFinite(overrides.ui.publish_port)
          ? overrides.ui.publish_port
          : inferPublishedUiPort(normalizeOptionalBaseUrl(overrides.ui?.public_base_url)),
      publish_bind_host: overrides.ui?.publish_bind_host?.trim() || "0.0.0.0"
    },
    hook: {
      enabled: overrides.hook?.enabled ?? true,
      hook_id: overrides.hook?.hook_id ?? OPENCLAW_MANAGER_PREROUTING_HOOK_ID
    },
    host_integration: {
      mode:
        overrides.host_integration?.mode ??
        (overrides.hook?.enabled === false ? "manual_adopt" : "managed_hook"),
      reason: overrides.host_integration?.reason ?? null
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
    },
    board_sync: {
      enabled:
        overrides.board_sync?.enabled ??
        Boolean(overrides.board_sync?.token?.trim() && overrides.board_sync?.push_url?.trim()),
      token: overrides.board_sync?.token?.trim() || null,
      push_url: normalizeOptionalBaseUrl(overrides.board_sync?.push_url) ?? null,
      push_interval_ms: overrides.board_sync?.push_interval_ms ?? 15000,
      push_on_mutation: overrides.board_sync?.push_on_mutation ?? true,
      timeout_ms: overrides.board_sync?.timeout_ms ?? 5000
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
  if (config.ui.public_base_url) {
    env.OPENCLAW_MANAGER_UI_PUBLIC_BASE_URL = config.ui.public_base_url;
  } else {
    delete env.OPENCLAW_MANAGER_UI_PUBLIC_BASE_URL;
  }
  if (config.ui.publish_port !== null) {
    env.OPENCLAW_MANAGER_UI_PUBLISH_PORT = `${config.ui.publish_port}`;
  } else {
    delete env.OPENCLAW_MANAGER_UI_PUBLISH_PORT;
  }
  env.OPENCLAW_MANAGER_UI_PUBLISH_BIND_HOST = config.ui.publish_bind_host;
  env.OPENCLAW_MANAGER_HOST_INTEGRATION_MODE = config.host_integration.mode;
  if (config.host_integration.reason) {
    env.OPENCLAW_MANAGER_HOST_INTEGRATION_REASON = config.host_integration.reason;
  } else {
    delete env.OPENCLAW_MANAGER_HOST_INTEGRATION_REASON;
  }
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_ENDPOINT = config.public_facts.endpoint;
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_TIMEOUT_MS = `${config.public_facts.timeout_ms}`;
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_SCHEMA_VERSION = config.public_facts.schema_version;
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_ENABLED = config.public_facts.auto_submit_enabled
    ? "1"
    : "0";
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_INTERVAL_MS = `${config.public_facts.auto_submit_interval_ms}`;
  env.OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_STARTUP_DELAY_MS = `${config.public_facts.auto_submit_startup_delay_ms}`;
  env.OPENCLAW_BOARD_SYNC_ENABLED = config.board_sync.enabled ? "1" : "0";
  if (config.board_sync.token) {
    env.OPENCLAW_BOARD_TOKEN = config.board_sync.token;
  } else {
    delete env.OPENCLAW_BOARD_TOKEN;
  }
  if (config.board_sync.push_url) {
    env.OPENCLAW_BOARD_PUSH_URL = config.board_sync.push_url;
  } else {
    delete env.OPENCLAW_BOARD_PUSH_URL;
  }
  env.OPENCLAW_BOARD_PUSH_INTERVAL_MS = `${config.board_sync.push_interval_ms}`;
  env.OPENCLAW_BOARD_PUSH_ON_MUTATION = config.board_sync.push_on_mutation ? "1" : "0";
  env.OPENCLAW_BOARD_PUSH_TIMEOUT_MS = `${config.board_sync.timeout_ms}`;
  env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG = resolveLocalChainConfigPath({
    ...env,
    OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG: env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG
  });
  return env;
}

function normalizeLocalChainConfig(raw: Record<string, unknown>): OpenClawManagerLocalChainConfig {
  const sidecarRecord = asRecord(raw.sidecar);
  const uiRecord = asRecord(raw.ui);
  const hookRecord = asRecord(raw.hook);
  const hostIntegrationRecord = asRecord(raw.host_integration);
  const publicFactsRecord = asRecord(raw.public_facts);
  const boardSyncRecord = asRecord(raw.board_sync);

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

  const uiOverrides: OpenClawManagerLocalChainConfigOverrides["ui"] | undefined = uiRecord
    ? {
        ...(typeof uiRecord.public_base_url === "string"
          ? { public_base_url: uiRecord.public_base_url }
          : {}),
        ...(typeof uiRecord.publish_port === "number" &&
          Number.isFinite(uiRecord.publish_port)
          ? { publish_port: uiRecord.publish_port }
          : {}),
        ...(typeof uiRecord.publish_bind_host === "string"
          ? { publish_bind_host: uiRecord.publish_bind_host }
          : {})
      }
    : undefined;

  const hostIntegrationOverrides:
    | OpenClawManagerLocalChainConfigOverrides["host_integration"]
    | undefined = hostIntegrationRecord
    ? {
        ...(hostIntegrationRecord.mode === "managed_hook" ||
        hostIntegrationRecord.mode === "manual_adopt"
          ? { mode: hostIntegrationRecord.mode }
          : {}),
        ...(typeof hostIntegrationRecord.reason === "string"
          ? { reason: hostIntegrationRecord.reason }
          : {})
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

  const boardSyncOverrides:
    | OpenClawManagerLocalChainConfigOverrides["board_sync"]
    | undefined = boardSyncRecord
    ? {
        ...(typeof boardSyncRecord.enabled === "boolean"
          ? { enabled: boardSyncRecord.enabled }
          : {}),
        ...(typeof boardSyncRecord.token === "string" ? { token: boardSyncRecord.token } : {}),
        ...(typeof boardSyncRecord.push_url === "string"
          ? { push_url: boardSyncRecord.push_url }
          : {}),
        ...(typeof boardSyncRecord.push_interval_ms === "number"
          ? { push_interval_ms: boardSyncRecord.push_interval_ms }
          : {}),
        ...(typeof boardSyncRecord.push_on_mutation === "boolean"
          ? { push_on_mutation: boardSyncRecord.push_on_mutation }
          : {}),
        ...(typeof boardSyncRecord.timeout_ms === "number"
          ? { timeout_ms: boardSyncRecord.timeout_ms }
          : {})
      }
    : undefined;

  return createDefaultLocalChainConfig({
    manager_base_url: typeof raw.manager_base_url === "string" ? raw.manager_base_url : undefined,
    sidecar: sidecarOverrides,
    ui: uiOverrides,
    hook: hookOverrides,
    host_integration: hostIntegrationOverrides,
    public_facts: publicFactsOverrides,
    board_sync: boardSyncOverrides
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

function normalizeOptionalBaseUrl(baseUrl: string | null | undefined): string | null {
  if (!baseUrl?.trim()) {
    return null;
  }

  return normalizeBaseUrl(baseUrl.trim());
}

function inferPublishedUiPort(baseUrl: string | null): number | null {
  if (!baseUrl) {
    return null;
  }

  try {
    const url = new URL(baseUrl);
    if (url.port) {
      const parsed = Number.parseInt(url.port, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
  } catch {
    return null;
  }

  return null;
}

function expandHomePath(value: string): string {
  return value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
}

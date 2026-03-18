import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

import { readBoardConfig, toBoardSyncConfig, writeBoardConfig } from "../src/board/board-config.ts";
import { getOrCreateIdentity, signTimestamp } from "../src/board/identity.ts";
import {
  createDefaultLocalChainConfig,
  readLocalChainConfig,
  resolveLocalChainConfigPath,
  writeLocalChainConfig
} from "../src/host/local-chain.ts";
import {
  DEFAULT_VIEWER_BOARD_PORT,
  buildBoardPushUrl,
  buildBoardViewerUrlFromPushUrl,
  deriveBoardBaseUrlFromPublicFactsEndpoint,
  validatePublishedUiBaseUrl
} from "../src/shared/ui.ts";
import { buildLocalSidecarServicePlan } from "../src/host/local-service.ts";
import { buildOpenClawManagerHostSetupPlan } from "../src/host/setup.ts";

interface CliOptions {
  dryRun: boolean;
  openclawBin?: string;
  managerBaseUrl?: string;
  managerPort?: number;
  stateRoot?: string;
  uiPublicBaseUrl?: string;
  publishUiPort?: number;
  publishUiBindHost?: string;
  enablePublicFacts: boolean;
  publicFactsEndpoint?: string;
  boardToken?: string;
  boardPushUrl?: string;
  boardPort?: number;
  boardRegisterUrl?: string;
  cloudHosted: boolean;
  skipHook: boolean;
  skipService: boolean;
  enablePublicFactsSpecified: boolean;
  cloudHostedSpecified: boolean;
  skipHookSpecified: boolean;
}

interface BoardRegistrationResult {
  status: "created" | "existing";
  token: string;
  board_url: string;
  push_url: string;
  owner_ref: string;
  created_at: string;
}

const SIDECAR_VERSION = "0.1.0";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = resolveLocalChainConfigPath();
  const existingConfig = await readLocalChainConfig(configPath);
  let config = createDefaultLocalChainConfig({
    manager_base_url: options.managerBaseUrl ?? existingConfig?.manager_base_url,
    sidecar: {
      port: options.managerPort ?? existingConfig?.sidecar.port,
      state_root: options.stateRoot ?? existingConfig?.sidecar.state_root
    },
    ui: {
      public_base_url: options.uiPublicBaseUrl ?? existingConfig?.ui.public_base_url,
      publish_port: options.publishUiPort ?? existingConfig?.ui.publish_port,
      publish_bind_host: options.publishUiBindHost ?? existingConfig?.ui.publish_bind_host
    },
    hook: {
      enabled:
        options.cloudHostedSpecified || options.skipHookSpecified
          ? !(options.cloudHosted || options.skipHook)
          : (existingConfig?.hook.enabled ?? true)
    },
    host_integration: {
      mode:
        options.cloudHostedSpecified || options.skipHookSpecified
          ? options.cloudHosted || options.skipHook
            ? "manual_adopt"
            : "managed_hook"
          : existingConfig?.host_integration.mode,
      reason:
        options.cloudHostedSpecified || options.skipHookSpecified
          ? options.cloudHosted
            ? "cloud_gateway_unavailable"
            : options.skipHook
              ? "hook_setup_skipped"
              : null
          : existingConfig?.host_integration.reason
    },
    public_facts: {
      auto_submit_enabled: options.enablePublicFactsSpecified
        ? options.enablePublicFacts
        : existingConfig?.public_facts.auto_submit_enabled,
      endpoint: options.publicFactsEndpoint ?? existingConfig?.public_facts.endpoint,
      timeout_ms: existingConfig?.public_facts.timeout_ms,
      schema_version: existingConfig?.public_facts.schema_version,
      auto_submit_interval_ms: existingConfig?.public_facts.auto_submit_interval_ms,
      auto_submit_startup_delay_ms: existingConfig?.public_facts.auto_submit_startup_delay_ms
    },
    board_sync: {
      enabled:
        options.boardToken !== undefined || options.boardPushUrl !== undefined
          ? Boolean(options.boardToken?.trim() || existingConfig?.board_sync.token?.trim())
          : existingConfig?.board_sync.enabled,
      token: options.boardToken ?? existingConfig?.board_sync.token,
      push_url: options.boardPushUrl ?? existingConfig?.board_sync.push_url,
      push_interval_ms: existingConfig?.board_sync.push_interval_ms,
      push_on_mutation: existingConfig?.board_sync.push_on_mutation,
      timeout_ms: existingConfig?.board_sync.timeout_ms
    }
  });

  let persistedBoardConfig = await readBoardConfig(config.sidecar.state_root);
  if (!config.board_sync.enabled && persistedBoardConfig) {
    config.board_sync = {
      ...config.board_sync,
      ...toBoardSyncConfig(persistedBoardConfig, config.board_sync)
    };
  }

  if (config.board_sync.enabled && !config.board_sync.push_url && config.board_sync.token) {
    const boardBaseUrl = deriveBoardBaseUrlFromPublicFactsEndpoint(
      config.public_facts.endpoint,
      options.boardPort ?? DEFAULT_VIEWER_BOARD_PORT
    );

    if (boardBaseUrl) {
      config.board_sync.push_url = buildBoardPushUrl(boardBaseUrl, config.board_sync.token);
    }
  }

  if (config.board_sync.enabled && (!config.board_sync.token || !config.board_sync.push_url)) {
    throw new Error(
      "Board sync requires both a board token and a board push URL. Pass --board-token and optionally --board-push-url."
    );
  }

  const hasExplicitBoardOverride =
    Boolean(options.boardToken?.trim()) || Boolean(options.boardPushUrl?.trim());

  if (!options.dryRun && !hasExplicitBoardOverride) {
    const registration = await registerBoard(config.sidecar.state_root, config.public_facts.endpoint, {
      register_url: options.boardRegisterUrl,
      board_port: options.boardPort
    });
    if (registration) {
      config.board_sync = {
        ...config.board_sync,
        enabled: true,
        token: registration.token,
        push_url: registration.push_url
      };
      persistedBoardConfig = {
        board_token: registration.token,
        board_url: registration.board_url,
        push_url: registration.push_url,
        owner_ref: registration.owner_ref,
        registered_at: new Date().toISOString()
      };
      await writeBoardConfig(config.sidecar.state_root, persistedBoardConfig);
    }
  }

  const uiValidationError = validatePublishedUiBaseUrl(config.ui.public_base_url, {
    manager_base_url: config.manager_base_url,
    public_facts_endpoint: config.public_facts.endpoint
  });

  if (uiValidationError) {
    throw new Error(uiValidationError);
  }

  const hookPlan = buildOpenClawManagerHostSetupPlan({
    repo_root: repoRoot,
    openclaw_bin: options.openclawBin,
    manager_base_url: config.manager_base_url
  });
  const servicePlan = buildLocalSidecarServicePlan({
    repo_root: repoRoot,
    config_path: configPath
  });

  console.log("OpenClaw Manager local-chain setup");
  console.log(`Config: ${configPath}`);
  console.log(`Manager base URL: ${config.manager_base_url}`);
  console.log(`Host integration mode: ${config.host_integration.mode}`);
  console.log(`Public facts endpoint: ${config.public_facts.endpoint}`);
  console.log(`Public facts auto submit: ${config.public_facts.auto_submit_enabled ? "enabled" : "disabled"}`);
  console.log(`Board sync: ${config.board_sync.enabled ? "enabled" : "disabled"}`);
  console.log(`Board push URL: ${config.board_sync.push_url ?? "not configured"}`);
  console.log(
    `Viewer board URL: ${buildBoardViewerUrlFromPushUrl(config.board_sync.push_url, config.board_sync.token) ?? "not configured"}`
  );
  console.log("Boundary: never expose the manager sidecar port directly; keep sidecar local-only, keep ingest separate, and use the shared viewer board service for remote/mobile read access.");

  if (options.dryRun) {
    printDryRun(hookPlan, servicePlan, options, config);
    return;
  }

  await writeLocalChainConfig(config, configPath);
  if (config.board_sync.enabled && config.board_sync.token && config.board_sync.push_url) {
    persistedBoardConfig = {
      board_token: config.board_sync.token,
      board_url:
        buildBoardViewerUrlFromPushUrl(config.board_sync.push_url, config.board_sync.token) ??
        "",
      push_url: config.board_sync.push_url,
      owner_ref: persistedBoardConfig?.owner_ref ?? null,
      registered_at: persistedBoardConfig?.registered_at ?? new Date().toISOString()
    };
    await writeBoardConfig(config.sidecar.state_root, {
      ...persistedBoardConfig
    });
  }

  if (!options.skipHook && !options.cloudHosted) {
    try {
      for (const command of hookPlan.enable_pre_routing) {
        runCommand(command.argv);
      }
    } catch (error) {
      console.warn(
        `Hook setup failed; continuing in manual /adopt mode: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      config = createDefaultLocalChainConfig({
        ...config,
        host_integration: {
          mode: "manual_adopt",
          reason: "hook_setup_failed"
        },
        hook: {
          ...config.hook,
          enabled: false
        }
      });
      await writeLocalChainConfig(config, configPath);
    }
  }

  if (!options.skipService) {
    await installLocalService(servicePlan);
  }

  console.log("\nLocal chain setup complete.");
  if (config.host_integration.mode === "managed_hook") {
    console.log("- Restart the OpenClaw gateway so the hook is reloaded.");
  } else {
    console.log("- Hook interception is not active; continue normal chat and use /adopt manually when a task should become durable.");
  }
  if (!config.ui.public_base_url) {
    console.log("- Session console stays local-only by default. Do not send http://127.0.0.1:8791/ui to mobile/remote users.");
  }
  if (config.board_sync.enabled) {
    console.log(
      `- Viewer board for users: ${
        buildBoardViewerUrlFromPushUrl(config.board_sync.push_url, config.board_sync.token) ?? "not configured"
      }`
    );
  }
  console.log(`- Local sidecar will run through ${path.join(repoRoot, "scripts", "run-local-sidecar.ts")}.`);
  console.log(`- Verify with: node ${path.join(repoRoot, "scripts", "doctor-local-chain.ts")}`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    enablePublicFacts: false,
    cloudHosted: false,
    skipHook: false,
    skipService: false,
    enablePublicFactsSpecified: false,
    cloudHostedSpecified: false,
    skipHookSpecified: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--openclaw-bin":
        options.openclawBin = argv[index + 1];
        index += 1;
        break;
      case "--manager-base-url":
        options.managerBaseUrl = argv[index + 1];
        index += 1;
        break;
      case "--manager-port":
        {
          const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
          options.managerPort = Number.isFinite(parsed) ? parsed : undefined;
        }
        index += 1;
        break;
      case "--state-root":
        options.stateRoot = argv[index + 1];
        index += 1;
        break;
      case "--ui-public-base-url":
        options.uiPublicBaseUrl = argv[index + 1];
        index += 1;
        break;
      case "--publish-ui-port":
        {
          const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
          options.publishUiPort = Number.isFinite(parsed) ? parsed : undefined;
        }
        index += 1;
        break;
      case "--publish-ui-bind-host":
        options.publishUiBindHost = argv[index + 1];
        index += 1;
        break;
      case "--enable-public-facts":
        options.enablePublicFacts = true;
        options.enablePublicFactsSpecified = true;
        break;
      case "--public-facts-endpoint":
        options.publicFactsEndpoint = argv[index + 1];
        index += 1;
        break;
      case "--board-token":
        options.boardToken = argv[index + 1];
        index += 1;
        break;
      case "--board-push-url":
        options.boardPushUrl = argv[index + 1];
        index += 1;
        break;
      case "--board-port":
        {
          const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
          options.boardPort = Number.isFinite(parsed) ? parsed : undefined;
        }
        index += 1;
        break;
      case "--board-register-url":
        options.boardRegisterUrl = argv[index + 1];
        index += 1;
        break;
      case "--cloud-hosted":
        options.cloudHosted = true;
        options.cloudHostedSpecified = true;
        break;
      case "--skip-hook":
        options.skipHook = true;
        options.skipHookSpecified = true;
        break;
      case "--skip-service":
        options.skipService = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printDryRun(
  hookPlan: ReturnType<typeof buildOpenClawManagerHostSetupPlan>,
  servicePlan: ReturnType<typeof buildLocalSidecarServicePlan>,
  options: CliOptions,
  config: ReturnType<typeof createDefaultLocalChainConfig>
): void {
  console.log("\nDry run");

  if (!options.skipHook) {
    if (options.cloudHosted) {
      console.log("\nHook setup:");
      console.log("- skipped: cloud-hosted OpenClaw Gateway cannot install managed hooks; setup will use manual /adopt mode.");
    } else {
      console.log("\nHook setup:");
      for (const command of hookPlan.enable_pre_routing) {
        console.log(`- ${command.argv.join(" ")}`);
      }
    }
  }

  if (!options.skipService) {
    console.log("\nLocal sidecar service:");
    console.log(`- kind: ${servicePlan.service_kind}`);
    console.log(`- path: ${servicePlan.service_path ?? "unsupported"}`);
    for (const command of [...servicePlan.install_commands, ...servicePlan.start_commands]) {
      console.log(`- ${command.join(" ")}`);
    }
  }

  console.log(
    `\nViewer board URL: ${
      buildBoardViewerUrlFromPushUrl(config.board_sync.push_url, config.board_sync.token) ??
      "not configured"
    }`
  );
  console.log(`Board push URL: ${config.board_sync.push_url ?? "not configured"}`);
}

async function registerBoard(
  stateRoot: string,
  publicFactsEndpoint: string,
  options: {
    register_url?: string;
    board_port?: number;
  }
): Promise<BoardRegistrationResult | null> {
  const registerUrl =
    options.register_url?.trim() ||
    process.env.OPENCLAW_BOARD_REGISTER_URL?.trim() ||
    deriveDefaultBoardRegisterUrl(publicFactsEndpoint, options.board_port ?? DEFAULT_VIEWER_BOARD_PORT);
  if (!registerUrl) {
    return null;
  }

  try {
    const identity = await getOrCreateIdentity(stateRoot);
    const timestamp = new Date().toISOString();
    const response = await fetch(registerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        owner_ref: identity.owner_ref,
        label: `${identity.node_id.slice(0, 12)} board`,
        install_proof: {
          sidecar_version: SIDECAR_VERSION,
          node_id: identity.node_id,
          timestamp,
          signature: signTimestamp(identity.node_secret, timestamp)
        }
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      console.warn(`Board registration failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const result = (await response.json()) as Partial<BoardRegistrationResult> | null;
    if (
      !result ||
      (result.status !== "created" && result.status !== "existing") ||
      typeof result.token !== "string" ||
      typeof result.board_url !== "string" ||
      typeof result.push_url !== "string" ||
      typeof result.owner_ref !== "string" ||
      typeof result.created_at !== "string"
    ) {
      console.warn("Board registration returned an invalid payload.");
      return null;
    }

    return {
      status: result.status,
      token: result.token,
      board_url: result.board_url,
      push_url: result.push_url,
      owner_ref: result.owner_ref,
      created_at: result.created_at
    };
  } catch (error) {
    console.warn(
      `Board registration failed; continuing without board sync: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

function deriveDefaultBoardRegisterUrl(
  publicFactsEndpoint: string,
  boardPort: number
): string | null {
  const boardBaseUrl = deriveBoardBaseUrlFromPublicFactsEndpoint(publicFactsEndpoint, boardPort);
  if (!boardBaseUrl) {
    return null;
  }

  return new URL("/register", `${boardBaseUrl}/`).toString();
}

async function installLocalService(
  plan: ReturnType<typeof buildLocalSidecarServicePlan>
): Promise<void> {
  if (plan.service_kind === "unsupported" || !plan.service_path || !plan.content) {
    console.warn("Skipping local sidecar service install: unsupported platform.");
    return;
  }

  await mkdir(path.dirname(plan.service_path), { recursive: true });
  if (plan.service_kind === "launchd") {
    await mkdir(path.join(os.homedir(), ".openclaw", "openclaw-manager", "logs"), {
      recursive: true
    });
  }
  await writeFile(plan.service_path, plan.content, "utf8");

  for (const command of plan.install_commands) {
    runCommand(command);
  }
  for (const command of plan.start_commands) {
    runCommand(command);
  }
}

function runCommand(argv: string[]): void {
  const result = spawnSync(argv[0]!, argv.slice(1), {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`Command failed with exit ${result.status ?? "unknown"}: ${argv.join(" ")}`);
  }
}

await main();

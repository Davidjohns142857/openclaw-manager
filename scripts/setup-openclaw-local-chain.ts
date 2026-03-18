import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

import {
  createDefaultLocalChainConfig,
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
  cloudHosted: boolean;
  skipHook: boolean;
  skipService: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let config = createDefaultLocalChainConfig({
    manager_base_url: options.managerBaseUrl,
    sidecar: {
      port: options.managerPort,
      state_root: options.stateRoot
    },
    ui: {
      public_base_url: options.uiPublicBaseUrl,
      publish_port: options.publishUiPort,
      publish_bind_host: options.publishUiBindHost
    },
    hook: {
      enabled: !(options.cloudHosted || options.skipHook)
    },
    host_integration: {
      mode: options.cloudHosted || options.skipHook ? "manual_adopt" : "managed_hook",
      reason: options.cloudHosted
        ? "cloud_gateway_unavailable"
        : options.skipHook
          ? "hook_setup_skipped"
          : null
    },
    public_facts: {
      auto_submit_enabled: options.enablePublicFacts,
      endpoint: options.publicFactsEndpoint
    },
    board_sync: {
      enabled: Boolean(options.boardToken?.trim()),
      token: options.boardToken,
      push_url: options.boardPushUrl
    }
  });

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

  const configPath = resolveLocalChainConfigPath();
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
    skipService: false
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
      case "--cloud-hosted":
        options.cloudHosted = true;
        break;
      case "--skip-hook":
        options.skipHook = true;
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

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
import { buildLocalSidecarServicePlan } from "../src/host/local-service.ts";
import { buildOpenClawManagerHostSetupPlan } from "../src/host/setup.ts";

interface CliOptions {
  dryRun: boolean;
  openclawBin?: string;
  managerBaseUrl?: string;
  managerPort?: number;
  stateRoot?: string;
  enablePublicFacts: boolean;
  publicFactsEndpoint?: string;
  skipHook: boolean;
  skipService: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config = createDefaultLocalChainConfig({
    manager_base_url: options.managerBaseUrl,
    sidecar: {
      port: options.managerPort,
      state_root: options.stateRoot
    },
    public_facts: {
      auto_submit_enabled: options.enablePublicFacts,
      endpoint: options.publicFactsEndpoint
    }
  });
  const configPath = resolveLocalChainConfigPath();
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
  console.log(`Public facts endpoint: ${config.public_facts.endpoint}`);
  console.log(`Public facts auto submit: ${config.public_facts.auto_submit_enabled ? "enabled" : "disabled"}`);

  if (options.dryRun) {
    printDryRun(hookPlan, servicePlan, options);
    return;
  }

  await writeLocalChainConfig(config, configPath);

  if (!options.skipHook) {
    for (const command of hookPlan.enable_pre_routing) {
      runCommand(command.argv);
    }
  }

  if (!options.skipService) {
    await installLocalService(servicePlan);
  }

  console.log("\nLocal chain setup complete.");
  console.log("- Restart the OpenClaw gateway so the hook is reloaded.");
  console.log(`- Local sidecar will run through ${path.join(repoRoot, "scripts", "run-local-sidecar.ts")}.`);
  console.log(`- Verify with: node ${path.join(repoRoot, "scripts", "doctor-local-chain.ts")}`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    enablePublicFacts: false,
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
        options.managerPort = Number.parseInt(argv[index + 1] ?? "", 10);
        index += 1;
        break;
      case "--state-root":
        options.stateRoot = argv[index + 1];
        index += 1;
        break;
      case "--enable-public-facts":
        options.enablePublicFacts = true;
        break;
      case "--public-facts-endpoint":
        options.publicFactsEndpoint = argv[index + 1];
        index += 1;
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
  options: CliOptions
): void {
  console.log("\nDry run");

  if (!options.skipHook) {
    console.log("\nHook setup:");
    for (const command of hookPlan.enable_pre_routing) {
      console.log(`- ${command.argv.join(" ")}`);
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

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpenClawManagerHostSetupPlan } from "../src/host/setup.ts";

interface CliOptions {
  dryRun: boolean;
  disablePreRouting: boolean;
  openclawBin?: string;
  managerBaseUrl?: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const plan = buildOpenClawManagerHostSetupPlan({
    repo_root: repoRoot,
    openclaw_bin: options.openclawBin,
    manager_base_url: options.managerBaseUrl
  });
  const commands = options.disablePreRouting
    ? plan.disable_pre_routing
    : plan.enable_pre_routing;

  console.log(
    `${options.disablePreRouting ? "Disable" : "Enable"} OpenClaw Manager pre-routing hook`
  );
  console.log(`Hook id: ${plan.hook_id}`);
  console.log(`Hook dir: ${plan.hook_dir}`);
  console.log(`Manager base URL: ${plan.manager_base_url}`);

  if (options.dryRun) {
    console.log("\nDry run:");
    for (const command of commands) {
      console.log(`- ${command.description}`);
      console.log(`  ${command.argv.join(" ")}`);
    }
    return;
  }

  for (const command of commands) {
    console.log(`\n> ${command.description}`);
    const result = spawnSync(command.argv[0]!, command.argv.slice(1), {
      stdio: "inherit"
    });

    if (result.status !== 0) {
      throw new Error(
        `Command failed with exit ${result.status ?? "unknown"}: ${command.argv.join(" ")}`
      );
    }
  }

  await probeSidecar(plan.manager_base_url);

  console.log("\nSetup complete.");
  for (const note of plan.notes) {
    console.log(`- ${note}`);
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    disablePreRouting: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--disable-pre-routing":
        options.disablePreRouting = true;
        break;
      case "--openclaw-bin":
        options.openclawBin = argv[index + 1];
        index += 1;
        break;
      case "--manager-base-url":
        options.managerBaseUrl = argv[index + 1];
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function probeSidecar(baseUrl: string): Promise<void> {
  try {
    const response = await fetch(new URL("/health", ensureTrailingSlash(baseUrl)).toString(), {
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      console.warn(
        `Warning: manager sidecar health probe returned HTTP ${response.status}.`
      );
      return;
    }

    const payload = (await response.json()) as {
      ui?: { session_console_url?: string };
      public_facts?: { endpoint?: string; auto_submit?: { enabled?: boolean } };
    };
    console.log(`Manager sidecar health probe succeeded at ${baseUrl}.`);
    if (payload.ui?.session_console_url) {
      console.log(`Session console: ${payload.ui.session_console_url}`);
    }
    if (payload.public_facts?.endpoint) {
      console.log(`Public facts endpoint: ${payload.public_facts.endpoint}`);
    }
    if (typeof payload.public_facts?.auto_submit?.enabled === "boolean") {
      console.log(
        `Public facts auto submit: ${payload.public_facts.auto_submit.enabled ? "enabled" : "disabled"}`
      );
    }
  } catch (error) {
    console.warn(
      `Warning: manager sidecar health probe failed at ${baseUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

await main();

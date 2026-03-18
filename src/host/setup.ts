import path from "node:path";

export const OPENCLAW_MANAGER_PREROUTING_HOOK_ID = "openclaw-manager-prerouting";
export const DEFAULT_MANAGER_BASE_URL = "http://127.0.0.1:8791";

export interface HostSetupCommand {
  description: string;
  argv: string[];
}

export interface OpenClawManagerHostSetupPlan {
  hook_id: string;
  hook_dir: string;
  manager_base_url: string;
  enable_pre_routing: HostSetupCommand[];
  disable_pre_routing: HostSetupCommand[];
  notes: string[];
}

export interface BuildHostSetupPlanOptions {
  repo_root: string;
  openclaw_bin?: string;
  manager_base_url?: string;
}

export function buildOpenClawManagerHostSetupPlan(
  options: BuildHostSetupPlanOptions
): OpenClawManagerHostSetupPlan {
  const hookDir = path.join(
    path.resolve(options.repo_root),
    "hooks",
    OPENCLAW_MANAGER_PREROUTING_HOOK_ID
  );
  const openclawBin = options.openclaw_bin?.trim() || "openclaw";
  const managerBaseUrl = normalizeBaseUrl(options.manager_base_url);

  return {
    hook_id: OPENCLAW_MANAGER_PREROUTING_HOOK_ID,
    hook_dir: hookDir,
    manager_base_url: managerBaseUrl,
    enable_pre_routing: [
      {
        description: "Install the managed pre-routing hook from this repository",
        argv: [openclawBin, "hooks", "install", "-l", hookDir]
      },
      {
        description: "Enable the OpenClaw Manager pre-routing hook",
        argv: [openclawBin, "hooks", "enable", OPENCLAW_MANAGER_PREROUTING_HOOK_ID]
      }
    ],
    disable_pre_routing: [
      {
        description: "Disable the OpenClaw Manager pre-routing hook",
        argv: [openclawBin, "hooks", "disable", OPENCLAW_MANAGER_PREROUTING_HOOK_ID]
      }
    ],
    notes: [
      "The hook defaults to http://127.0.0.1:8791 when OPENCLAW_MANAGER_BASE_URL is not set.",
      "Restart the OpenClaw gateway after enabling or disabling the hook.",
      "Current OpenClaw install actions can fetch the manager bundle, but custom post-install prompts still require this one-time setup helper."
    ]
  };
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const value = baseUrl?.trim() || DEFAULT_MANAGER_BASE_URL;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

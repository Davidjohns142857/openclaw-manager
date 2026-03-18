import os from "node:os";
import path from "node:path";

export interface LocalSidecarServicePlan {
  service_kind: "launchd" | "systemd-user" | "unsupported";
  service_id: string;
  service_path: string | null;
  content: string | null;
  install_commands: string[][];
  start_commands: string[][];
}

export interface BuildLocalSidecarServicePlanOptions {
  repo_root: string;
  node_executable?: string;
  config_path: string;
  platform?: NodeJS.Platform;
}

export function buildLocalSidecarServicePlan(
  options: BuildLocalSidecarServicePlanOptions
): LocalSidecarServicePlan {
  const repoRoot = path.resolve(options.repo_root);
  const nodeExecutable = options.node_executable?.trim() || process.execPath;
  const configPath = path.resolve(options.config_path);
  const serviceId = "ai.openclaw.manager.local";
  const runScriptPath = path.join(repoRoot, "scripts", "run-local-sidecar.ts");
  const platform = options.platform ?? process.platform;
  const currentUserId = typeof process.getuid === "function" ? process.getuid() : 0;

  if (platform === "darwin") {
    const servicePath = path.join(
      os.homedir(),
      "Library",
      "LaunchAgents",
      `${serviceId}.plist`
    );
    const stdoutPath = path.join(os.homedir(), ".openclaw", "openclaw-manager", "logs", "sidecar.out.log");
    const stderrPath = path.join(os.homedir(), ".openclaw", "openclaw-manager", "logs", "sidecar.err.log");

    return {
      service_kind: "launchd",
      service_id: serviceId,
      service_path: servicePath,
      content: renderLaunchdPlist(serviceId, nodeExecutable, runScriptPath, configPath, stdoutPath, stderrPath),
      install_commands: [
        ["launchctl", "bootstrap", `gui/${currentUserId}`, servicePath],
        ["launchctl", "enable", `gui/${currentUserId}/${serviceId}`]
      ],
      start_commands: [
        ["launchctl", "kickstart", "-k", `gui/${currentUserId}/${serviceId}`]
      ]
    };
  }

  if (platform === "linux") {
    const servicePath = path.join(
      os.homedir(),
      ".config",
      "systemd",
      "user",
      "openclaw-manager-local.service"
    );

    return {
      service_kind: "systemd-user",
      service_id: "openclaw-manager-local",
      service_path: servicePath,
      content: renderSystemdUnit(nodeExecutable, runScriptPath, configPath),
      install_commands: [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "openclaw-manager-local.service"]],
      start_commands: [["systemctl", "--user", "restart", "openclaw-manager-local.service"]]
    };
  }

  return {
    service_kind: "unsupported",
    service_id: serviceId,
    service_path: null,
    content: null,
    install_commands: [],
    start_commands: []
  };
}

function renderLaunchdPlist(
  serviceId: string,
  nodeExecutable: string,
  runScriptPath: string,
  configPath: string,
  stdoutPath: string,
  stderrPath: string
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${serviceId}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${escapeXml(nodeExecutable)}</string>
      <string>${escapeXml(runScriptPath)}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG</key>
      <string>${escapeXml(configPath)}</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(stderrPath)}</string>
  </dict>
</plist>
`;
}

function renderSystemdUnit(
  nodeExecutable: string,
  runScriptPath: string,
  configPath: string
): string {
  return `[Unit]
Description=OpenClaw Manager local sidecar
After=network.target

[Service]
Type=simple
Environment=OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG=${configPath}
ExecStart=${nodeExecutable} ${runScriptPath}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

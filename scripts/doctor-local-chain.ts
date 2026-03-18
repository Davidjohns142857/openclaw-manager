import { readBoardConfig, toBoardSyncConfig } from "../src/board/board-config.ts";
import {
  readLocalChainConfig,
  resolveLocalChainConfigPath
} from "../src/host/local-chain.ts";
import {
  buildBoardHealthUrlFromPushUrl,
  buildBoardViewerUrlFromPushUrl,
  validatePublishedUiBaseUrl
} from "../src/shared/ui.ts";

async function main(): Promise<void> {
  const configPath = resolveLocalChainConfigPath();
  const config = await readLocalChainConfig(configPath);

  console.log(`Local chain config: ${configPath}`);
  if (!config) {
    console.log("Status: missing");
    process.exitCode = 1;
    return;
  }

  const persistedBoardConfig = await readBoardConfig(config.sidecar.state_root);
  const effectiveBoardSync =
    !config.board_sync.enabled && persistedBoardConfig
      ? toBoardSyncConfig(persistedBoardConfig, config.board_sync)
      : {
          enabled: config.board_sync.enabled,
          board_token: config.board_sync.token,
          board_push_url: config.board_sync.push_url,
          push_interval_ms: config.board_sync.push_interval_ms,
          push_on_mutation: config.board_sync.push_on_mutation,
          timeout_ms: config.board_sync.timeout_ms
        };

  console.log(`Manager base URL: ${config.manager_base_url}`);
  console.log(`State root: ${config.sidecar.state_root}`);
  console.log(`Host integration mode: ${config.host_integration.mode}`);
  console.log(`Host integration reason: ${config.host_integration.reason ?? "none"}`);
  console.log(`Published UI base URL: ${config.ui.public_base_url ?? "not configured"}`);
  console.log(`Published UI proxy port: ${config.ui.publish_port ?? "not configured"}`);
  console.log(`Published UI bind host: ${config.ui.publish_bind_host}`);
  console.log(`Viewer board URL: ${buildBoardViewerUrlFromPushUrl(effectiveBoardSync.board_push_url, effectiveBoardSync.board_token) ?? "not configured"}`);
  console.log(`Board sync enabled: ${effectiveBoardSync.enabled}`);
  console.log(`Board push URL: ${effectiveBoardSync.board_push_url ?? "not configured"}`);
  if (persistedBoardConfig) {
    console.log(`Board config file: present (${config.sidecar.state_root}/board-config.json)`);
  }
  console.log(`Public facts endpoint: ${config.public_facts.endpoint}`);
  console.log(`Public facts auto submit: ${config.public_facts.auto_submit_enabled ? "enabled" : "disabled"}`);

  const uiValidationError = validatePublishedUiBaseUrl(config.ui.public_base_url, {
    manager_base_url: config.manager_base_url,
    public_facts_endpoint: config.public_facts.endpoint
  });
  if (uiValidationError) {
    console.log(`Published UI boundary: invalid (${uiValidationError})`);
    process.exitCode = 1;
  } else {
    console.log("Published UI boundary: ok");
  }

  const localHealth = await tryJson(new URL("/health", ensureTrailingSlash(config.manager_base_url)).toString());
  if (!localHealth) {
    console.log("Local sidecar health: unreachable");
    process.exitCode = 1;
    return;
  }

  console.log("Local sidecar health: ok");
  console.log(JSON.stringify(localHealth, null, 2));
  if (config.host_integration.mode === "manual_adopt") {
    console.log("Manual workflow: keep normal conversation and use /adopt when a task should become durable.");
  }

  if (config.ui.publish_port !== null) {
    const publishedHealth = await tryJson(
      `http://127.0.0.1:${config.ui.publish_port}/health`
    );
    if (!publishedHealth) {
      console.log("Published UI proxy health: unreachable");
      process.exitCode = 1;
    } else {
      console.log("Published UI proxy health: ok");
      console.log(JSON.stringify(publishedHealth, null, 2));
    }
  }

  if (effectiveBoardSync.enabled) {
    const boardHealthUrl = buildBoardHealthUrlFromPushUrl(
      effectiveBoardSync.board_push_url,
      effectiveBoardSync.board_token
    );
    if (!boardHealthUrl) {
      console.log("Viewer board health: invalid configuration");
      process.exitCode = 1;
    } else {
      const boardHealth = await tryJson(boardHealthUrl);
      if (!boardHealth) {
        console.log("Viewer board health: unreachable");
        process.exitCode = 1;
      } else {
        console.log("Viewer board health: ok");
        console.log(JSON.stringify(boardHealth, null, 2));
      }
    }
  }

  const publicHealth = await tryJson(rewriteToHealth(config.public_facts.endpoint));
  if (!publicHealth) {
    console.log("Public ingest health: unreachable");
    process.exitCode = 1;
    return;
  }

  console.log("Public ingest health: ok");
  console.log(JSON.stringify(publicHealth, null, 2));

  const publicFacts = await tryJson(rewriteToFacts(config.public_facts.endpoint));
  if (publicFacts) {
    console.log("Public facts sample:");
    console.log(JSON.stringify(publicFacts, null, 2));
  }
}

async function tryJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function rewriteToHealth(endpoint: string): string {
  return endpoint.replace(/\/v1\/ingest\/?$/u, "/v1/health");
}

function rewriteToFacts(endpoint: string): string {
  return endpoint.replace(/\/v1\/ingest\/?$/u, "/v1/facts");
}

await main();

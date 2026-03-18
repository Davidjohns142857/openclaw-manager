import {
  readLocalChainConfig,
  resolveLocalChainConfigPath
} from "../src/host/local-chain.ts";
import { validatePublishedUiBaseUrl } from "../src/shared/ui.ts";

async function main(): Promise<void> {
  const configPath = resolveLocalChainConfigPath();
  const config = await readLocalChainConfig(configPath);

  console.log(`Local chain config: ${configPath}`);
  if (!config) {
    console.log("Status: missing");
    process.exitCode = 1;
    return;
  }

  console.log(`Manager base URL: ${config.manager_base_url}`);
  console.log(`State root: ${config.sidecar.state_root}`);
  console.log(`Host integration mode: ${config.host_integration.mode}`);
  console.log(`Host integration reason: ${config.host_integration.reason ?? "none"}`);
  console.log(`Published UI base URL: ${config.ui.public_base_url ?? "not configured"}`);
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

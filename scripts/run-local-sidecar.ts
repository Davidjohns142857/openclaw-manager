import {
  applyLocalChainConfigToEnv,
  readLocalChainConfig,
  resolveLocalChainConfigPath
} from "../src/host/local-chain.ts";

const configPath = resolveLocalChainConfigPath();
const config = await readLocalChainConfig(configPath);

if (config) {
  applyLocalChainConfigToEnv(config, process.env);
  process.env.OPENCLAW_MANAGER_LOCAL_CHAIN_CONFIG = configPath;
}

await import("../src/main.ts");

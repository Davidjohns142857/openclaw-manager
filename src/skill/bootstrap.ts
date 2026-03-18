import { resolveConfig } from "../config.ts";
import { ControlPlane } from "../control-plane/control-plane.ts";
import { FilesystemStore } from "../storage/fs-store.ts";
import type { ManagerConfig } from "../shared/types.ts";
import { PublicFactAutoSubmitService } from "../telemetry/public-fact-auto-submit.ts";

export async function bootstrapManager(
  overrides: Partial<ManagerConfig> = {}
): Promise<{
  config: ManagerConfig;
  store: FilesystemStore;
  controlPlane: ControlPlane;
  publicFactAutoSubmitService: PublicFactAutoSubmitService;
}> {
  const resolved = resolveConfig();
  const config = {
    ...resolved,
    ...overrides,
    features: {
      ...resolved.features,
      ...overrides.features
    },
    public_facts: {
      ...resolved.public_facts,
      ...overrides.public_facts
    }
  };
  const store = new FilesystemStore(config);
  const controlPlane = new ControlPlane(config, store);
  const publicFactAutoSubmitService = new PublicFactAutoSubmitService(config, controlPlane);

  await controlPlane.initialize();
  publicFactAutoSubmitService.start();

  return { config, store, controlPlane, publicFactAutoSubmitService };
}

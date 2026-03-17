import { resolveConfig } from "../config.ts";
import { ControlPlane } from "../control-plane/control-plane.ts";
import { FilesystemStore } from "../storage/fs-store.ts";
import type { ManagerConfig } from "../shared/types.ts";

export async function bootstrapManager(
  overrides: Partial<ManagerConfig> = {}
): Promise<{ config: ManagerConfig; store: FilesystemStore; controlPlane: ControlPlane }> {
  const config = {
    ...resolveConfig(),
    ...overrides
  };
  const store = new FilesystemStore(config);
  const controlPlane = new ControlPlane(config, store);

  await controlPlane.initialize();

  return { config, store, controlPlane };
}


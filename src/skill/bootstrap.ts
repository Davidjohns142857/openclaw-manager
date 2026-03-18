import { resolveConfig } from "../config.ts";
import { BoardSyncService } from "../board/board-sync.ts";
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
  boardSyncService: BoardSyncService;
}> {
  const resolved = resolveConfig();
  const config = {
    ...resolved,
    ...overrides,
    features: {
      ...resolved.features,
      ...overrides.features
    },
    ui: {
      ...resolved.ui,
      ...overrides.ui
    },
    host_integration: {
      ...resolved.host_integration,
      ...overrides.host_integration
    },
    public_facts: {
      ...resolved.public_facts,
      ...overrides.public_facts
    },
    board_sync: {
      ...resolved.board_sync,
      ...overrides.board_sync
    }
  };

  const store = new FilesystemStore(config);
  const controlPlane = new ControlPlane(config, store);
  const publicFactAutoSubmitService = new PublicFactAutoSubmitService(config, controlPlane);
  const boardSyncService = new BoardSyncService(config.board_sync, controlPlane);

  await controlPlane.initialize();
  publicFactAutoSubmitService.start();
  controlPlane.setBoardSyncService(boardSyncService);
  boardSyncService.start();

  return { config, store, controlPlane, publicFactAutoSubmitService, boardSyncService };
}

import { resolveConfig } from "../config.ts";
import { ControlPlane } from "../control-plane/control-plane.ts";
import { FilesystemStore } from "../storage/fs-store.ts";
import type { ManagerConfig } from "../shared/types.ts";
import { PublicFactAutoSubmitService } from "../telemetry/public-fact-auto-submit.ts";
import {
  DEFAULT_PUBLISHED_UI_PROXY_PORT,
  derivePublishedUiBaseUrlFromPublicFactsEndpoint
} from "../shared/ui.ts";

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
    }
  };

  if (!config.ui.public_base_url && config.host_integration.mode === "manual_adopt") {
    const publishPort = config.ui.publish_port ?? DEFAULT_PUBLISHED_UI_PROXY_PORT;
    if (config.public_facts.auto_submit_enabled) {
      const derivedBaseUrl = derivePublishedUiBaseUrlFromPublicFactsEndpoint(
        config.public_facts.endpoint,
        publishPort
      );
      if (derivedBaseUrl) {
        config.ui = {
          ...config.ui,
          public_base_url: derivedBaseUrl,
          publish_port: publishPort
        };
      }
    }
  }

  const store = new FilesystemStore(config);
  const controlPlane = new ControlPlane(config, store);
  const publicFactAutoSubmitService = new PublicFactAutoSubmitService(config, controlPlane);

  await controlPlane.initialize();
  publicFactAutoSubmitService.start();

  return { config, store, controlPlane, publicFactAutoSubmitService };
}

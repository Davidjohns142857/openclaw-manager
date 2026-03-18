import type { HostAdmissionPolicy } from "./admission-policy.ts";
import type { HostCapturedMessage } from "./context.ts";
import type {
  HostAdmissionManagerClient,
  SuggestOrAdoptResult
} from "./suggest-or-adopt.ts";
import { suggestOrAdopt } from "./suggest-or-adopt.ts";
import { ManagerSidecarClient, resolveManagerBaseUrl } from "../skill/sidecar-client.ts";

export type OpenClawManagerPreRoutingAction =
  | "continue_default_routing"
  | "show_adopt_suggestion"
  | "short_circuit_to_manager";

export interface OpenClawManagerPreRoutingResult {
  action: OpenClawManagerPreRoutingAction;
  session_console_url: string | null;
  manager: SuggestOrAdoptResult;
}

export interface OpenClawManagerPreRoutingOptions {
  client?: HostAdmissionManagerClient;
  policy?: HostAdmissionPolicy;
  sidecar_base_url?: string;
  session_console_url?: string;
}

export async function runOpenClawManagerPreRoutingHook(
  message: HostCapturedMessage,
  options: OpenClawManagerPreRoutingOptions = {}
): Promise<OpenClawManagerPreRoutingResult> {
  const sidecarBaseUrl = normalizeBaseUrl(
    options.sidecar_base_url ?? resolveManagerBaseUrl()
  );
  const client =
    options.client ?? new ManagerSidecarClient({ baseUrl: sidecarBaseUrl });
  const manager = await suggestOrAdopt(client, message, options.policy);

  return {
    action: mapManagerOutcomeToHostAction(manager.outcome),
    session_console_url: options.session_console_url ?? null,
    manager
  };
}

export function mapManagerOutcomeToHostAction(
  outcome: SuggestOrAdoptResult["outcome"]
): OpenClawManagerPreRoutingAction {
  switch (outcome) {
    case "ignored":
      return "continue_default_routing";
    case "suggested":
      return "show_adopt_suggestion";
    case "adopted_new_session":
    case "routed_to_existing_session":
      return "short_circuit_to_manager";
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

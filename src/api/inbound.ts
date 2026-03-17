import type { NormalizeInboundMessageInput } from "../connectors/base.ts";
import { ControlPlane } from "../control-plane/control-plane.ts";
import { serializeSession } from "./serializers.ts";

export async function handleInboundApi(
  controlPlane: ControlPlane,
  body: NormalizeInboundMessageInput
): Promise<Record<string, unknown>> {
  const result = await controlPlane.handleInboundMessage(body);

  return {
    duplicate: result.duplicate,
    queued: result.queued,
    run_started: result.run_started,
    run: result.run,
    session: serializeSession(result.session, result.run)
  };
}

import { deriveSessionActivity } from "../shared/activity.ts";
import { deriveSessionStatusReason } from "../shared/session-status.ts";
import type { NormalizedInboundMessage, Run, Session } from "../shared/types.ts";
import { ControlPlane } from "../control-plane/control-plane.ts";
import type {
  InboundMessageResponse,
  SessionDetailEnvelope,
  SessionWithActivity
} from "../skill/sidecar-client.ts";
import type { HostAdmissionManagerClient } from "./suggest-or-adopt.ts";
import type { HostCapturedMessage } from "./context.ts";
import type { HostAdmissionPolicy } from "./admission-policy.ts";
import {
  buildSessionConsoleUrl,
  mapManagerOutcomeToHostAction,
  type OpenClawManagerPreRoutingResult
} from "./prerouting-hook.ts";
import { suggestOrAdopt } from "./suggest-or-adopt.ts";

export async function runManagerPreRoutingViaControlPlane(
  controlPlane: ControlPlane,
  message: HostCapturedMessage,
  options: {
    policy?: HostAdmissionPolicy;
    sidecar_base_url: string;
  }
): Promise<OpenClawManagerPreRoutingResult> {
  const manager = await suggestOrAdopt(
    createHostAdmissionControlPlaneClient(controlPlane),
    message,
    options.policy
  );

  return {
    action: mapManagerOutcomeToHostAction(manager.outcome),
    session_console_url: buildSessionConsoleUrl(options.sidecar_base_url),
    manager
  };
}

function createHostAdmissionControlPlaneClient(
  controlPlane: ControlPlane
): HostAdmissionManagerClient {
  return {
    async listSessions() {
      const sessions = await controlPlane.listTasks();
      return Promise.all(
        sessions.map(async (session) =>
          toSessionWithActivity(session, await latestRun(controlPlane, session))
        )
      );
    },
    async focus() {
      return controlPlane.focus();
    },
    async adopt(input) {
      const adopted = await controlPlane.adoptSession(input);
      const detail = await controlPlane.getSessionDetail(adopted.session.session_id);
      return hydrateSessionDetail(detail.session, detail.run, detail.checkpoint, detail.summary);
    },
    async inboundMessage(message) {
      const result = await controlPlane.handleInboundMessage(message as NormalizedInboundMessage);
      return hydrateInboundResponse(result.session, result.run, {
        duplicate: result.duplicate,
        queued: result.queued,
        run_started: result.run_started
      });
    }
  };
}

async function latestRun(controlPlane: ControlPlane, session: Session): Promise<Run | null> {
  if (session.active_run_id) {
    return controlPlane.store.readRun(session.session_id, session.active_run_id);
  }

  return controlPlane.getLatestRun(session.session_id);
}

function toSessionWithActivity(session: Session, run: Run | null): SessionWithActivity {
  return {
    ...session,
    status_reason: deriveSessionStatusReason(session, run),
    activity: deriveSessionActivity(session, run)
  };
}

function hydrateSessionDetail(
  session: Session,
  run: Run | null,
  checkpoint: SessionDetailEnvelope["checkpoint"],
  summary: string | null
): SessionDetailEnvelope {
  return {
    session: toSessionWithActivity(session, run),
    run,
    checkpoint,
    summary
  };
}

function hydrateInboundResponse(
  session: Session,
  run: Run | null,
  meta: Pick<InboundMessageResponse, "duplicate" | "queued" | "run_started">
): InboundMessageResponse {
  return {
    ...meta,
    run,
    session: toSessionWithActivity(session, run)
  };
}

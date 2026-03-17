import { createId } from "../shared/ids.ts";
import { isoNow } from "../shared/time.ts";
import type { AdoptSessionInput } from "../shared/contracts.ts";
import type { Session } from "../shared/types.ts";
import { FilesystemStore } from "../storage/fs-store.ts";

export class SessionService {
  store: FilesystemStore;

  constructor(store: FilesystemStore) {
    this.store = store;
  }

  async createSession(input: AdoptSessionInput): Promise<Session> {
    const now = isoNow();

    const session: Session = {
      session_id: createId("sess"),
      title: input.title,
      objective: input.objective,
      owner: {
        type: "human",
        ref: input.owner_ref ?? "user_primary"
      },
      status: "active",
      lifecycle_stage: "execution",
      priority: input.priority ?? "medium",
      scenario_signature: input.scenario_signature ?? null,
      tags: input.tags ?? [],
      source_channels: input.source_channel ? [input.source_channel] : [],
      active_run_id: null,
      latest_summary_ref: "summary.md",
      latest_checkpoint_ref: null,
      state: {
        phase: "intake",
        goal_status: "in_progress",
        blockers: [],
        pending_human_decisions: [],
        pending_external_inputs: [],
        next_machine_actions: input.next_machine_actions ?? [],
        next_human_actions: []
      },
      metrics: {
        run_count: 0,
        failed_run_count: 0,
        human_intervention_count: 0,
        artifact_count: 0,
        last_activity_at: now
      },
      sharing: {
        is_shareable: true,
        latest_snapshot_id: null
      },
      created_at: now,
      updated_at: now,
      archived_at: null,
      metadata: {
        created_via: "adopt_command",
        pending_inbound_count: 0,
        summary_needs_refresh: false,
        ...input.metadata
      }
    };

    await this.store.writeSession(session);
    return session;
  }

  async saveSession(session: Session): Promise<Session> {
    const nextSession: Session = {
      ...session,
      updated_at: isoNow()
    };

    await this.store.writeSession(nextSession);
    return nextSession;
  }

  async listSessions(): Promise<Session[]> {
    const sessions = await this.store.listSessions();
    return sessions.sort((left, right) =>
      right.metrics.last_activity_at.localeCompare(left.metrics.last_activity_at)
    );
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.store.readSession(sessionId);
  }

  async requireSession(sessionId: string): Promise<Session> {
    const session = await this.getSession(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return session;
  }
}


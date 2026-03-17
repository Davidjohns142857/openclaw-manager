import type { AttentionUnit, Session, SessionIndexEntry } from "../shared/types.ts";

export interface SessionIndexes {
  sessions: SessionIndexEntry[];
  activeSessions: SessionIndexEntry[];
}

export function buildSessionIndexes(sessions: Session[]): SessionIndexes {
  const entries = sessions
    .map<SessionIndexEntry>((session) => ({
      session_id: session.session_id,
      title: session.title,
      status: session.status,
      lifecycle_stage: session.lifecycle_stage,
      priority: session.priority,
      active_run_id: session.active_run_id,
      last_activity_at: session.metrics.last_activity_at,
      tags: session.tags
    }))
    .sort((left, right) => right.last_activity_at.localeCompare(left.last_activity_at));

  return {
    sessions: entries,
    activeSessions: entries.filter((entry) =>
      ["draft", "active", "waiting_human", "blocked"].includes(entry.status)
    )
  };
}

export function sortAttentionQueue(units: AttentionUnit[]): AttentionUnit[] {
  return [...units].sort((left, right) => {
    if (right.attention_priority !== left.attention_priority) {
      return right.attention_priority - left.attention_priority;
    }

    return right.created_at.localeCompare(left.created_at);
  });
}


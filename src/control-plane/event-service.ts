import { createCorrelationId, createId } from "../shared/ids.ts";
import { isoNow } from "../shared/time.ts";
import type { Event, EventActor, EventCausality, EventType } from "../shared/types.ts";
import { FilesystemStore } from "../storage/fs-store.ts";

export interface RecordEventInput {
  sessionId: string;
  runId?: string | null;
  eventType: EventType;
  actor?: EventActor;
  causality?: Partial<EventCausality>;
  payload?: Record<string, unknown> | null;
  payloadRef?: string | null;
  metadata?: Record<string, unknown>;
}

export class EventService {
  store: FilesystemStore;

  constructor(store: FilesystemStore) {
    this.store = store;
  }

  async record(input: RecordEventInput): Promise<Event> {
    const event: Event = {
      event_id: createId("evt"),
      session_id: input.sessionId,
      run_id: input.runId ?? null,
      event_type: input.eventType,
      actor: input.actor ?? {
        actor_type: "agent",
        actor_ref: "openclaw_manager"
      },
      causality: {
        causal_parent: input.causality?.causal_parent ?? null,
        correlation_id: input.causality?.correlation_id ?? createCorrelationId(),
        request_id: input.causality?.request_id ?? null,
        external_trigger_id: input.causality?.external_trigger_id ?? null
      },
      payload: input.payload ?? null,
      payload_ref: input.payloadRef ?? null,
      timestamp: isoNow(),
      metadata: input.metadata ?? {}
    };

    await this.store.appendEvent(event.session_id, event.run_id, event);
    return event;
  }
}


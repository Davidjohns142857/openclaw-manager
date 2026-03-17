import { createId } from "../shared/ids.ts";
import { isoNow } from "../shared/time.ts";
import type { BindSourceInput } from "../shared/contracts.ts";
import type { ConnectorBinding, Run, Session, SourceChannel } from "../shared/types.ts";
import { FilesystemStore } from "../storage/fs-store.ts";
import { EventService } from "./event-service.ts";
import { SessionService } from "./session-service.ts";

export class ConnectorBindingConflictError extends Error {}
export class ConnectorBindingNotFoundError extends Error {}

export class BindingService {
  store: FilesystemStore;
  sessionService: SessionService;
  eventService: EventService;

  constructor(store: FilesystemStore, sessionService: SessionService, eventService: EventService) {
    this.store = store;
    this.sessionService = sessionService;
    this.eventService = eventService;
  }

  async listBindings(): Promise<ConnectorBinding[]> {
    const bindings = await this.store.readBindings();
    return bindings.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async findActiveBinding(
    sourceType: string,
    sourceThreadKey: string
  ): Promise<ConnectorBinding | null> {
    const bindings = await this.store.readBindings();
    return (
      bindings.find(
        (binding) =>
          binding.status === "active" &&
          binding.source_type === sourceType &&
          binding.source_thread_key === sourceThreadKey
      ) ?? null
    );
  }

  async bindSource(
    session: Session,
    run: Run | null,
    input: BindSourceInput
  ): Promise<{ binding: ConnectorBinding; session: Session; created: boolean }> {
    const bindings = await this.store.readBindings();
    const existing = bindings.find(
      (binding) =>
        binding.source_type === input.source_type &&
        binding.source_thread_key === input.source_thread_key &&
        binding.status === "active"
    );

    if (existing && existing.session_id !== session.session_id) {
      throw new ConnectorBindingConflictError(
        `Source ${input.source_type}:${input.source_thread_key} is already bound to ${existing.session_id}.`
      );
    }

    const now = isoNow();
    const sourceChannel = buildSourceChannel(input, now);
    let nextSession = session;

    if (
      !nextSession.source_channels.some(
        (channel) =>
          channel.source_type === sourceChannel.source_type &&
          channel.source_ref === sourceChannel.source_ref
      )
    ) {
      nextSession = await this.sessionService.saveSession({
        ...nextSession,
        source_channels: [...nextSession.source_channels, sourceChannel]
      });
    }

    const nextBinding: ConnectorBinding = existing
      ? {
          ...existing,
          status: "active",
          updated_at: now,
          metadata: {
            ...existing.metadata,
            ...input.metadata
          }
        }
      : {
          binding_id: createId("bind"),
          source_type: input.source_type,
          source_thread_key: input.source_thread_key,
          session_id: session.session_id,
          status: "active",
          created_at: now,
          updated_at: now,
          metadata: input.metadata ?? {}
        };

    const withoutReplaced = bindings.filter((binding) => binding.binding_id !== nextBinding.binding_id);
    await this.store.writeBindings([...withoutReplaced, nextBinding]);

    await this.eventService.record({
      sessionId: session.session_id,
      runId: run?.run_id ?? null,
      eventType: "external_trigger_bound",
      actor: {
        actor_type: "human",
        actor_ref: nextSession.owner.ref
      },
      payload: {
        binding_id: nextBinding.binding_id,
        source_type: nextBinding.source_type,
        source_thread_key: nextBinding.source_thread_key,
        created: !existing
      }
    });

    return {
      binding: nextBinding,
      session: nextSession,
      created: !existing
    };
  }

  async resolveTargetSessionId(
    sourceType: string,
    sourceThreadKey: string,
    explicitTargetSessionId?: string
  ): Promise<string> {
    const binding = await this.findActiveBinding(sourceType, sourceThreadKey);

    if (explicitTargetSessionId) {
      if (binding && binding.session_id !== explicitTargetSessionId) {
        throw new ConnectorBindingConflictError(
          `Source ${sourceType}:${sourceThreadKey} is bound to ${binding.session_id}, not ${explicitTargetSessionId}.`
        );
      }

      return explicitTargetSessionId;
    }

    if (!binding) {
      throw new ConnectorBindingNotFoundError(
        `No active binding found for ${sourceType}:${sourceThreadKey}.`
      );
    }

    return binding.session_id;
  }
}

function buildSourceChannel(input: BindSourceInput, boundAt: string): SourceChannel {
  return {
    source_type: input.source_type,
    source_ref: input.source_thread_key,
    bound_at: boundAt,
    metadata: input.metadata
  };
}

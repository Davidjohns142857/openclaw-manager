import { createId } from "../shared/ids.ts";
import { isoNow } from "../shared/time.ts";
import type {
  BindingListFilters,
  BindSourceInput,
  DisableBindingInput,
  RebindSourceInput
} from "../shared/contracts.ts";
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

  async listBindings(filters: BindingListFilters = {}): Promise<ConnectorBinding[]> {
    const bindings = await this.store.readBindings();
    return bindings
      .filter((binding) => matchesBindingFilters(binding, filters))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
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
    const nextSession = await this.persistSessionSourceChannelIfMissing(session, sourceChannel);

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

  async disableBinding(
    bindingId: string,
    input: DisableBindingInput
  ): Promise<{ binding: ConnectorBinding; session: Session; changed: boolean }> {
    const bindings = await this.store.readBindings();
    const existing = requireBinding(bindings, bindingId);
    const session = await this.sessionService.requireSession(existing.session_id);

    if (existing.status === "disabled") {
      return {
        binding: existing,
        session,
        changed: false
      };
    }

    const disabledAt = input.disabled_at ?? isoNow();
    const nextBinding: ConnectorBinding = {
      ...existing,
      status: "disabled",
      updated_at: disabledAt,
      metadata: {
        ...existing.metadata,
        lifecycle_last_action: "disabled",
        disabled_at: disabledAt,
        disabled_by_ref: input.disabled_by_ref ?? null,
        disable_reason: input.reason ?? null,
        disable_metadata: input.metadata ?? {}
      }
    };
    const nextSession = await this.persistSessionSourceChannelRemoval(session, existing);

    await this.store.writeBindings(replaceBinding(bindings, nextBinding));
    const lifecycleRunId = await this.resolveLifecycleRunId(session);
    await this.eventService.record({
      sessionId: session.session_id,
      runId: lifecycleRunId,
      eventType: "external_trigger_unbound",
      actor: {
        actor_type: "human",
        actor_ref: input.disabled_by_ref ?? session.owner.ref
      },
      payload: {
        binding_id: nextBinding.binding_id,
        source_type: nextBinding.source_type,
        source_thread_key: nextBinding.source_thread_key,
        reason: input.reason ?? null
      }
    });

    return {
      binding: nextBinding,
      session: nextSession,
      changed: true
    };
  }

  async rebindBinding(
    bindingId: string,
    targetSession: Session,
    input: RebindSourceInput
  ): Promise<{
    binding: ConnectorBinding;
    session: Session;
    previousSessionId: string;
    changed: boolean;
  }> {
    const bindings = await this.store.readBindings();
    const existing = requireBinding(bindings, bindingId);
    const conflicting = bindings.find(
      (binding) =>
        binding.binding_id !== existing.binding_id &&
        binding.status === "active" &&
        binding.source_type === existing.source_type &&
        binding.source_thread_key === existing.source_thread_key
    );

    if (conflicting) {
      throw new ConnectorBindingConflictError(
        `Source ${existing.source_type}:${existing.source_thread_key} is already bound to ${conflicting.session_id}.`
      );
    }

    const unchanged =
      existing.status === "active" && existing.session_id === targetSession.session_id;
    if (unchanged) {
      return {
        binding: existing,
        session: targetSession,
        previousSessionId: existing.session_id,
        changed: false
      };
    }

    const reboundAt = input.rebound_at ?? isoNow();
    const previousSession = await this.sessionService.requireSession(existing.session_id);
    const sourceChannel = buildSourceChannel(
      {
        session_id: targetSession.session_id,
        source_type: existing.source_type,
        source_thread_key: existing.source_thread_key,
        metadata: input.metadata ?? existing.metadata
      },
      reboundAt
    );
    const nextPreviousSession =
      previousSession.session_id === targetSession.session_id
        ? previousSession
        : await this.persistSessionSourceChannelRemoval(previousSession, existing);
    const nextTargetSession = await this.persistSessionSourceChannel(targetSession, sourceChannel);
    const nextBinding: ConnectorBinding = {
      ...existing,
      session_id: targetSession.session_id,
      status: "active",
      updated_at: reboundAt,
      metadata: {
        ...existing.metadata,
        lifecycle_last_action: "rebound",
        rebound_at: reboundAt,
        rebound_by_ref: input.rebound_by_ref ?? null,
        rebound_from_session_id: existing.session_id,
        rebound_to_session_id: targetSession.session_id,
        rebind_metadata: input.metadata ?? {}
      }
    };

    await this.store.writeBindings(replaceBinding(bindings, nextBinding));
    const targetRunId = await this.resolveLifecycleRunId(nextTargetSession);

    const eventPayload = {
      binding_id: nextBinding.binding_id,
      source_type: nextBinding.source_type,
      source_thread_key: nextBinding.source_thread_key,
      previous_session_id: existing.session_id,
      session_id: targetSession.session_id
    };

    await this.eventService.record({
      sessionId: nextTargetSession.session_id,
      runId: targetRunId,
      eventType: "external_trigger_rebound",
      actor: {
        actor_type: "human",
        actor_ref: input.rebound_by_ref ?? targetSession.owner.ref
      },
      payload: eventPayload
    });

    if (nextPreviousSession.session_id !== nextTargetSession.session_id) {
      const previousRunId = await this.resolveLifecycleRunId(nextPreviousSession);
      await this.eventService.record({
        sessionId: nextPreviousSession.session_id,
        runId: previousRunId,
        eventType: "external_trigger_rebound",
        actor: {
          actor_type: "human",
          actor_ref: input.rebound_by_ref ?? targetSession.owner.ref
        },
        payload: eventPayload
      });
    }

    return {
      binding: nextBinding,
      session: nextTargetSession,
      previousSessionId: existing.session_id,
      changed: true
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

  private async persistSessionSourceChannelIfMissing(
    session: Session,
    sourceChannel: SourceChannel
  ): Promise<Session> {
    const exists = session.source_channels.some(
      (channel) =>
        channel.source_type === sourceChannel.source_type &&
        channel.source_ref === sourceChannel.source_ref
    );

    if (exists) {
      return session;
    }

    return this.sessionService.saveSession({
      ...session,
      source_channels: [...session.source_channels, sourceChannel]
    });
  }

  private async persistSessionSourceChannel(
    session: Session,
    sourceChannel: SourceChannel
  ): Promise<Session> {
    const nextChannels = upsertSourceChannel(session.source_channels, sourceChannel);
    if (nextChannels === session.source_channels) {
      return session;
    }

    return this.sessionService.saveSession({
      ...session,
      source_channels: nextChannels
    });
  }

  private async persistSessionSourceChannelRemoval(
    session: Session,
    binding: Pick<ConnectorBinding, "source_type" | "source_thread_key">
  ): Promise<Session> {
    const nextChannels = session.source_channels.filter(
      (channel) =>
        !(
          channel.source_type === binding.source_type &&
          channel.source_ref === binding.source_thread_key
        )
    );

    if (nextChannels.length === session.source_channels.length) {
      return session;
    }

    return this.sessionService.saveSession({
      ...session,
      source_channels: nextChannels
    });
  }

  private async resolveLifecycleRunId(session: Session): Promise<string | null> {
    if (session.active_run_id) {
      return session.active_run_id;
    }

    const [latestRun] = await this.store.listRuns(session.session_id);
    return latestRun?.run_id ?? null;
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

function requireBinding(bindings: ConnectorBinding[], bindingId: string): ConnectorBinding {
  const binding = bindings.find((candidate) => candidate.binding_id === bindingId);
  if (!binding) {
    throw new ConnectorBindingNotFoundError(`Binding ${bindingId} was not found.`);
  }

  return binding;
}

function replaceBinding(bindings: ConnectorBinding[], nextBinding: ConnectorBinding): ConnectorBinding[] {
  return [
    ...bindings.filter((binding) => binding.binding_id !== nextBinding.binding_id),
    nextBinding
  ];
}

function upsertSourceChannel(
  sourceChannels: SourceChannel[],
  nextChannel: SourceChannel
): SourceChannel[] {
  const existingIndex = sourceChannels.findIndex(
    (channel) =>
      channel.source_type === nextChannel.source_type && channel.source_ref === nextChannel.source_ref
  );

  if (existingIndex === -1) {
    return [...sourceChannels, nextChannel];
  }

  const existing = sourceChannels[existingIndex];
  const unchanged =
    existing.bound_at === nextChannel.bound_at &&
    JSON.stringify(existing.metadata ?? {}) === JSON.stringify(nextChannel.metadata ?? {});
  if (unchanged) {
    return sourceChannels;
  }

  const nextChannels = [...sourceChannels];
  nextChannels[existingIndex] = nextChannel;
  return nextChannels;
}

function matchesBindingFilters(
  binding: ConnectorBinding,
  filters: BindingListFilters
): boolean {
  return (
    (filters.binding_id === undefined || binding.binding_id === filters.binding_id) &&
    (filters.session_id === undefined || binding.session_id === filters.session_id) &&
    (filters.source_type === undefined || binding.source_type === filters.source_type) &&
    (filters.source_thread_key === undefined ||
      binding.source_thread_key === filters.source_thread_key) &&
    (filters.status === undefined || binding.status === filters.status)
  );
}

import type {
  AdoptSessionInput,
  BindSourceInput,
  CloseSessionInput,
  DisableBindingInput,
  RebindSourceInput
} from "../shared/contracts.ts";
import type { SourceChannel } from "../shared/types.ts";

export interface ManagerCommandDefinition {
  command: string;
  usage: string;
  description: string;
}

export interface ManagerCommandClient {
  listSessions(): Promise<unknown>;
  focus(): Promise<unknown>;
  digest(): Promise<unknown>;
  adopt(input: AdoptSessionInput): Promise<unknown>;
  bind(input: BindSourceInput): Promise<unknown>;
  disableBinding(bindingId: string, input: DisableBindingInput): Promise<unknown>;
  rebindBinding(bindingId: string, input: RebindSourceInput): Promise<unknown>;
  resume(sessionId: string): Promise<unknown>;
  checkpoint(sessionId: string): Promise<unknown>;
  share(sessionId: string): Promise<unknown>;
  close(sessionId: string, input: CloseSessionInput): Promise<unknown>;
}

export const managerCommands: ManagerCommandDefinition[] = [
  {
    command: "/tasks",
    usage: "/tasks",
    description: "List durable task sessions and active runs."
  },
  {
    command: "/resume",
    usage: "/resume <session_id>",
    description: "Resume a session from checkpoint and summary."
  },
  {
    command: "/share",
    usage: "/share <session_id>",
    description: "Export a read-only task snapshot."
  },
  {
    command: "/focus",
    usage: "/focus",
    description: "Show derived attention units that need human action."
  },
  {
    command: "/digest",
    usage: "/digest",
    description: "Generate a compressed multi-task digest."
  },
  {
    command: "/checkpoint",
    usage: "/checkpoint <session_id>",
    description: "Refresh checkpoint.json and summary.md for a session."
  },
  {
    command: "/close",
    usage: "/close <session_id>",
    description: "Close a session and emit minimal closure facts."
  },
  {
    command: "/adopt",
    usage: "/adopt",
    description: "Promote a task conversation into a durable session."
  },
  {
    command: "/bind",
    usage: "/bind <session_id> <source_type> <source_thread_key>",
    description: "Bind an external source thread to an existing session."
  },
  {
    command: "/unbind",
    usage: "/unbind <binding_id>",
    description: "Disable an active external-source binding without deleting its history."
  },
  {
    command: "/rebind",
    usage: "/rebind <binding_id> <session_id>",
    description: "Move or reactivate an external-source binding onto a target session."
  }
];

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asPriority(value: unknown): AdoptSessionInput["priority"] | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "critical"
    ? value
    : undefined;
}

function asSourceChannel(value: unknown): SourceChannel | undefined {
  const candidate = asRecord(value);
  if (!candidate) {
    return undefined;
  }

  if (
    typeof candidate.source_type !== "string" ||
    typeof candidate.source_ref !== "string" ||
    typeof candidate.bound_at !== "string"
  ) {
    return undefined;
  }

  return {
    source_type: candidate.source_type,
    source_ref: candidate.source_ref,
    bound_at: candidate.bound_at,
    metadata: asRecord(candidate.metadata)
  };
}

function requireSessionId(payload: Record<string, unknown>): string {
  if (typeof payload.session_id !== "string" || payload.session_id.trim().length === 0) {
    throw new Error("session_id is required for this command.");
  }

  return payload.session_id;
}

function requireBindingId(payload: Record<string, unknown>): string {
  if (typeof payload.binding_id !== "string" || payload.binding_id.trim().length === 0) {
    throw new Error("binding_id is required for this command.");
  }

  return payload.binding_id;
}

export async function executeManagerCommand(
  client: ManagerCommandClient,
  command: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  switch (command) {
    case "/tasks":
      return client.listSessions();
    case "/focus":
      return client.focus();
    case "/digest":
      return client.digest();
    case "/adopt":
      return client.adopt({
        title: String(payload.title ?? "Untitled task"),
        objective: String(payload.objective ?? "No objective provided"),
        owner_ref: typeof payload.owner_ref === "string" ? payload.owner_ref : undefined,
        priority: asPriority(payload.priority),
        tags: asStringArray(payload.tags),
        scenario_signature:
          typeof payload.scenario_signature === "string" ? payload.scenario_signature : undefined,
        source_channel: asSourceChannel(payload.source_channel),
        next_machine_actions: asStringArray(payload.next_machine_actions),
        metadata: asRecord(payload.metadata)
      });
    case "/bind":
      return client.bind({
        session_id: requireSessionId(payload),
        source_type: String(payload.source_type ?? ""),
        source_thread_key: String(payload.source_thread_key ?? ""),
        metadata: asRecord(payload.metadata)
      });
    case "/unbind":
      return client.disableBinding(requireBindingId(payload), {
        reason: typeof payload.reason === "string" ? payload.reason : undefined,
        disabled_by_ref:
          typeof payload.disabled_by_ref === "string" ? payload.disabled_by_ref : undefined,
        disabled_at: typeof payload.disabled_at === "string" ? payload.disabled_at : undefined,
        metadata: asRecord(payload.metadata)
      });
    case "/rebind":
      return client.rebindBinding(requireBindingId(payload), {
        session_id: requireSessionId(payload),
        rebound_by_ref:
          typeof payload.rebound_by_ref === "string" ? payload.rebound_by_ref : undefined,
        rebound_at: typeof payload.rebound_at === "string" ? payload.rebound_at : undefined,
        metadata: asRecord(payload.metadata)
      });
    case "/resume":
      return client.resume(requireSessionId(payload));
    case "/checkpoint":
      return client.checkpoint(requireSessionId(payload));
    case "/share":
      return client.share(requireSessionId(payload));
    case "/close":
      return client.close(requireSessionId(payload), {
        resolution: payload.resolution === "abandoned" ? "abandoned" : "completed",
        outcome_summary: String(payload.outcome_summary ?? "Closed through command surface.")
      });
    default:
      throw new Error(`Unsupported manager command: ${command}`);
  }
}

import type { ControlPlane } from "../control-plane/control-plane.ts";

export interface ManagerCommandDefinition {
  command: string;
  usage: string;
  description: string;
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
  }
];

export async function executeManagerCommand(
  controlPlane: ControlPlane,
  command: string,
  payload: Record<string, unknown> = {}
): Promise<unknown> {
  switch (command) {
    case "/tasks":
      return controlPlane.listTasks();
    case "/focus":
      return controlPlane.focus();
    case "/digest":
      return controlPlane.digest();
    case "/adopt":
      return controlPlane.adoptSession({
        title: String(payload.title ?? "Untitled task"),
        objective: String(payload.objective ?? "No objective provided"),
        owner_ref: typeof payload.owner_ref === "string" ? payload.owner_ref : undefined,
        priority:
          payload.priority === "low" ||
          payload.priority === "medium" ||
          payload.priority === "high" ||
          payload.priority === "critical"
            ? payload.priority
            : undefined,
        tags: Array.isArray(payload.tags)
          ? payload.tags.filter((value): value is string => typeof value === "string")
          : undefined,
        next_machine_actions: Array.isArray(payload.next_machine_actions)
          ? payload.next_machine_actions.filter((value): value is string => typeof value === "string")
          : undefined
      });
    case "/resume":
      return controlPlane.resumeSession(String(payload.session_id ?? ""));
    case "/checkpoint":
      return controlPlane.refreshCheckpoint(String(payload.session_id ?? ""));
    case "/share":
      return controlPlane.shareSession(String(payload.session_id ?? ""));
    case "/close":
      return controlPlane.closeSession(String(payload.session_id ?? ""), {
        resolution: payload.resolution === "abandoned" ? "abandoned" : "completed",
        outcome_summary: String(payload.outcome_summary ?? "Closed through command surface.")
      });
    default:
      throw new Error(`Unsupported manager command: ${command}`);
  }
}


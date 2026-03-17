import type { AttentionUnit, SessionStatus } from "../shared/types.ts";
import type { SessionWithActivity } from "../skill/sidecar-client.ts";

export interface HostCapturedMessage {
  text: string;
  source_type: string;
  source_thread_key?: string;
  message_id?: string;
  received_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ExistingSessionMatch {
  session_id: string;
  title: string;
  match_type: "source_thread" | "keyword_overlap";
  confidence: number;
  reason_codes: string[];
}

export interface HostAdmissionContext {
  message_text: string;
  source_type: string;
  source_thread_key: string | null;
  message_id: string | null;
  capture_key: string | null;
  active_session_count: number;
  focus_backlog: number;
  keyword_hits: string[];
  structural_signals: string[];
  existing_session_match: ExistingSessionMatch | null;
}

export interface HostContextClient {
  listSessions(): Promise<SessionWithActivity[]>;
  focus(): Promise<AttentionUnit[]>;
}

const terminalStatuses = new Set<SessionStatus>(["completed", "abandoned", "archived"]);

const keywordRules = [
  { code: "keyword_task", patterns: [/任务/u, /task\b/i, /事项/u] },
  { code: "keyword_research", patterns: [/研究/u, /调研/u, /research\b/i, /investigate\b/i, /帮我查/u, /查一下/u] },
  { code: "keyword_follow_up", patterns: [/跟进/u, /后续/u, /持续/u, /继续/u, /follow[\s-]?up\b/i] },
  { code: "keyword_project", patterns: [/项目/u, /课题/u, /project\b/i] },
  { code: "keyword_todo", patterns: [/待办/u, /\btodo\b/i, /to-do\b/i, /checklist\b/i] },
  { code: "keyword_deliverable", patterns: [/整理/u, /报告/u, /文档/u, /交付/u, /deliverable\b/i, /report\b/i, /doc(?:ument)?\b/i] }
] as const;

const structuralRules = [
  {
    code: "long_horizon_task",
    patterns: [/长期/u, /后续/u, /持续/u, /继续/u, /阶段/u, /后面/u, /接下来/u, /ongoing\b/i, /later\b/i]
  },
  {
    code: "external_dependency",
    patterns: [/依赖/u, /等待/u, /审批/u, /确认/u, /上游/u, /外部/u, /dependency\b/i, /approval\b/i, /upstream\b/i]
  },
  {
    code: "deliverable_present",
    patterns: [/报告/u, /文档/u, /表格/u, /清单/u, /ppt\b/i, /slides?\b/i, /report\b/i, /deliverable\b/i]
  },
  {
    code: "follow_up_action",
    patterns: [/帮我/u, /请/u, /需要/u, /下一步/u, /记得/u, /follow[\s-]?up\b/i, /please\b/i]
  }
] as const;

export async function collectHostContext(
  client: HostContextClient,
  message: HostCapturedMessage
): Promise<HostAdmissionContext> {
  const [sessions, focus] = await Promise.all([client.listSessions(), client.focus()]);
  const activeSessions = sessions.filter((session) => !terminalStatuses.has(session.status));

  return {
    message_text: normalizeWhitespace(message.text),
    source_type: normalizeWhitespace(message.source_type),
    source_thread_key: cleanOptional(message.source_thread_key),
    message_id: cleanOptional(message.message_id),
    capture_key: resolveHostCaptureKey(message),
    active_session_count: activeSessions.length,
    focus_backlog: focus.length,
    keyword_hits: detectKeywordHits(message.text),
    structural_signals: detectStructuralSignals(message.text),
    existing_session_match: findExistingSessionMatch(activeSessions, message)
  };
}

export function detectKeywordHits(text: string): string[] {
  return runPatternRules(text, keywordRules);
}

export function detectStructuralSignals(text: string): string[] {
  return runPatternRules(text, structuralRules);
}

export function resolveHostCaptureKey(message: HostCapturedMessage): string | null {
  const sourceType = cleanOptional(message.source_type);
  const sourceThreadKey = cleanOptional(message.source_thread_key);
  const messageId = cleanOptional(message.message_id);

  if (!sourceType || !sourceThreadKey || !messageId) {
    return null;
  }

  return `${sourceType}::${sourceThreadKey}::${messageId}`;
}

function runPatternRules(
  text: string,
  rules: ReadonlyArray<{ code: string; patterns: ReadonlyArray<RegExp> }>
): string[] {
  const normalized = normalizeWhitespace(text);
  const hits = new Set<string>();

  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      hits.add(rule.code);
    }
  }

  return [...hits];
}

function findExistingSessionMatch(
  sessions: SessionWithActivity[],
  message: HostCapturedMessage
): ExistingSessionMatch | null {
  const sourceThreadKey = cleanOptional(message.source_thread_key);

  if (sourceThreadKey) {
    for (const session of sessions) {
      const exactChannel = session.source_channels.find(
        (channel) =>
          channel.source_type === message.source_type && channel.source_ref === sourceThreadKey
      );

      if (exactChannel) {
        return {
          session_id: session.session_id,
          title: session.title,
          match_type: "source_thread",
          confidence: 0.98,
          reason_codes: ["existing_source_thread_match"]
        };
      }
    }
  }

  const messageTokens = extractMatchTokens(message.text);
  let bestMatch: ExistingSessionMatch | null = null;

  for (const session of sessions) {
    const sessionTokens = extractMatchTokens(
      [session.title, session.objective, session.scenario_signature ?? "", ...session.tags].join(" ")
    );
    const overlap = [...messageTokens].filter((token) => sessionTokens.has(token));

    if (overlap.length < 2) {
      continue;
    }

    const confidence = clamp(0.4 + overlap.length * 0.12, 0.4, 0.78);
    const candidate: ExistingSessionMatch = {
      session_id: session.session_id,
      title: session.title,
      match_type: "keyword_overlap",
      confidence,
      reason_codes: ["existing_keyword_overlap", ...overlap.slice(0, 3).map((token) => `token:${token}`)]
    };

    if (!bestMatch || candidate.confidence > bestMatch.confidence) {
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

function extractMatchTokens(text: string): Set<string> {
  const normalized = normalizeWhitespace(text).toLowerCase();
  const matches = normalized.match(/[a-z0-9_]{3,}|[\p{Script=Han}]{2,}/gu) ?? [];
  const tokens = new Set<string>();

  for (const token of matches) {
    if (token.length < 2) {
      continue;
    }

    tokens.add(token);

    if (/^[\p{Script=Han}]+$/u.test(token)) {
      for (const gram of expandHanToken(token)) {
        tokens.add(gram);
      }
    }
  }

  return tokens;
}

function cleanOptional(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function expandHanToken(token: string): string[] {
  const chars = [...token];
  const grams = new Set<string>();

  for (let size = 2; size <= Math.min(4, chars.length); size += 1) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      grams.add(chars.slice(index, index + size).join(""));
    }
  }

  return [...grams];
}

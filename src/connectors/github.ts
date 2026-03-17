import { createHash } from "node:crypto";

import type { ExternalInboundMessageInput } from "./base.ts";

export interface GitHubWebhookEnvelope {
  delivery_id?: string | null;
  event: string;
  body: Record<string, unknown>;
}

export interface GitHubIgnoredWebhook {
  accepted: false;
  ignored: true;
  reason: string;
  event: string;
  action: string | null;
}

export interface GitHubAcceptedWebhook {
  accepted: true;
  ignored: false;
  event: string;
  action: string | null;
  source_thread_key: string;
  inbound: ExternalInboundMessageInput;
}

export type GitHubWebhookNormalizationResult = GitHubIgnoredWebhook | GitHubAcceptedWebhook;

export function normalizeGitHubWebhook(
  envelope: GitHubWebhookEnvelope
): GitHubWebhookNormalizationResult {
  const event = envelope.event.trim();
  const action = asString(envelope.body.action);

  if (event === "ping") {
    return {
      accepted: false,
      ignored: true,
      reason: "ping_event",
      event,
      action
    };
  }

  if (event === "issue_comment") {
    return normalizeIssueCommentWebhook(envelope, action);
  }

  if (event === "issues") {
    return normalizeIssueWebhook(envelope, action);
  }

  return {
    accepted: false,
    ignored: true,
    reason: "unsupported_event",
    event,
    action
  };
}

export function githubIssueThreadKey(
  repositoryFullName: string,
  issueNumber: number | string
): string {
  return `github:${repositoryFullName}/issues/${issueNumber}`;
}

function normalizeIssueCommentWebhook(
  envelope: GitHubWebhookEnvelope,
  action: string | null
): GitHubWebhookNormalizationResult {
  if (action !== "created" && action !== "edited") {
    return {
      accepted: false,
      ignored: true,
      reason: "unsupported_issue_comment_action",
      event: envelope.event,
      action
    };
  }

  const repository = requireRepositoryFullName(envelope.body);
  const issue = requireNestedRecord(envelope.body, "issue");
  const comment = requireNestedRecord(envelope.body, "comment");
  const issueNumber = requireNumber(issue, "number");
  const sourceThreadKey = githubIssueThreadKey(repository, issueNumber);
  const content = asString(comment.body) ?? asString(issue.title) ?? "";
  const htmlUrl = asString(comment.html_url) ?? asString(issue.html_url);
  const sender = getNestedString(envelope.body, "sender", "login");

  return {
    accepted: true,
    ignored: false,
    event: envelope.event,
    action,
    source_thread_key: sourceThreadKey,
    inbound: {
      request_id: deriveGitHubRequestId(envelope),
      external_trigger_id: envelope.delivery_id ?? null,
      source_type: "github",
      source_thread_key: sourceThreadKey,
      message_type: "user_message",
      content,
      attachments: htmlUrl
        ? [
            {
              name: "github_comment",
              ref: htmlUrl
            }
          ]
        : [],
      metadata: {
        connector: "github",
        event: envelope.event,
        action,
        repository_full_name: repository,
        issue_number: issueNumber,
        sender_login: sender,
        comment_id: asNumber(comment.id),
        issue_html_url: asString(issue.html_url) ?? null,
        comment_html_url: htmlUrl ?? null
      }
    }
  };
}

function normalizeIssueWebhook(
  envelope: GitHubWebhookEnvelope,
  action: string | null
): GitHubWebhookNormalizationResult {
  if (!["opened", "edited", "reopened", "closed"].includes(action ?? "")) {
    return {
      accepted: false,
      ignored: true,
      reason: "unsupported_issue_action",
      event: envelope.event,
      action
    };
  }

  const repository = requireRepositoryFullName(envelope.body);
  const issue = requireNestedRecord(envelope.body, "issue");
  const issueNumber = requireNumber(issue, "number");
  const sourceThreadKey = githubIssueThreadKey(repository, issueNumber);
  const title = asString(issue.title) ?? `Issue #${issueNumber}`;
  const body = asString(issue.body);
  const sender = getNestedString(envelope.body, "sender", "login");

  return {
    accepted: true,
    ignored: false,
    event: envelope.event,
    action,
    source_thread_key: sourceThreadKey,
    inbound: {
      request_id: deriveGitHubRequestId(envelope),
      external_trigger_id: envelope.delivery_id ?? null,
      source_type: "github",
      source_thread_key: sourceThreadKey,
      message_type: "system_update",
      content: body ? `# ${title}\n\n${body}` : `# ${title}`,
      attachments: asString(issue.html_url)
        ? [
            {
              name: "github_issue",
              ref: asString(issue.html_url) ?? undefined
            }
          ]
        : [],
      metadata: {
        connector: "github",
        event: envelope.event,
        action,
        repository_full_name: repository,
        issue_number: issueNumber,
        sender_login: sender,
        issue_state: asString(issue.state) ?? null,
        issue_html_url: asString(issue.html_url) ?? null
      }
    }
  };
}

function deriveGitHubRequestId(envelope: GitHubWebhookEnvelope): string {
  if (envelope.delivery_id && envelope.delivery_id.trim()) {
    return `req_github_${sanitizeForRequestId(envelope.delivery_id)}`;
  }

  const seed = JSON.stringify({
    event: envelope.event,
    action: envelope.body.action ?? null,
    repository: getNestedString(envelope.body, "repository", "full_name"),
    issue: getNestedNumber(envelope.body, "issue", "number"),
    comment: getNestedNumber(envelope.body, "comment", "id")
  });

  return `req_github_${createHash("sha1").update(seed).digest("hex").slice(0, 16)}`;
}

function sanitizeForRequestId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function requireRepositoryFullName(body: Record<string, unknown>): string {
  const repository = requireNestedRecord(body, "repository");
  const fullName = asString(repository.full_name);

  if (!fullName) {
    throw new Error("GitHub webhook payload is missing repository.full_name.");
  }

  return fullName;
}

function requireNestedRecord(
  body: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const value = body[key];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`GitHub webhook payload is missing ${key}.`);
  }

  return value as Record<string, unknown>;
}

function requireNumber(body: Record<string, unknown>, key: string): number {
  const value = asNumber(body[key]);

  if (value === null) {
    throw new Error(`GitHub webhook payload is missing ${key}.`);
  }

  return value;
}

function getNestedString(
  body: Record<string, unknown>,
  outerKey: string,
  innerKey: string
): string | null {
  const nested = body[outerKey];
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
    return null;
  }

  return asString((nested as Record<string, unknown>)[innerKey]);
}

function getNestedNumber(
  body: Record<string, unknown>,
  outerKey: string,
  innerKey: string
): number | null {
  const nested = body[outerKey];
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
    return null;
  }

  return asNumber((nested as Record<string, unknown>)[innerKey]);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

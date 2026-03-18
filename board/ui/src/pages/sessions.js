import { fetchDigest, fetchFocus, fetchSessions } from "../lib/api.js";
import { render, statusBadge, priorityLabel, esc, poll } from "../lib/render.js";
import { timeAgo } from "../lib/time.js";

export function mount() {
  render(`<div class="loading">Loading sessions</div>`);

  return poll(async () => {
    try {
      const [sessions, focus, digest] = await Promise.all([
        fetchSessions(),
        fetchFocus(),
        fetchDigest()
      ]);
      renderPage(sessions, focus, digest);
    } catch (error) {
      render(`<div class="empty-state">Failed to load sessions: ${esc(error.message)}</div>`);
    }
  }, 10_000);
}

function renderPage(sessions, focus, digest) {
  const focusIds = new Set(focus.map((item) => item.session_id));
  const focusCategoryBySessionId = new Map(
    focus.map((item) => [item.session_id, item.category])
  );
  const sorted = [...sessions].sort((left, right) => {
    const leftFocus = focusIds.has(left.session_id) ? 1 : 0;
    const rightFocus = focusIds.has(right.session_id) ? 1 : 0;
    if (rightFocus !== leftFocus) {
      return rightFocus - leftFocus;
    }

    return (right.metrics?.last_activity_at ?? "").localeCompare(left.metrics?.last_activity_at ?? "");
  });

  render(`
    <div class="card" style="margin-bottom:var(--space-lg);">
      <div class="section-header">Board Digest</div>
      <div class="markdown-body">${renderDigest(digest.digest)}</div>
    </div>

    ${
      focus.length > 0
        ? `<div class="section-header" style="color:var(--color-waiting);">Needs Attention (${focus.length})</div>
           ${focus.map((item) => renderFocusRow(item, sessions)).join("")}`
        : ""
    }

    <div class="section-header" style="margin-top:${focus.length > 0 ? "var(--space-xl)" : "0"}">Sessions (${sessions.length})</div>
    ${
      sorted.length === 0
        ? `<div class="empty-state">No sessions visible for this board token yet.</div>`
        : sorted.map((session) => renderSessionRow(session, focusCategoryBySessionId)).join("")
    }
  `);
}

function renderFocusRow(item, sessions) {
  const session = sessions.find((entry) => entry.session_id === item.session_id);

  return `
    <a href="#/sessions/${encodeURIComponent(item.session_id)}" class="session-row">
      <div class="card" style="border-left:3px solid var(--color-waiting);">
        <div style="display:flex;justify-content:space-between;gap:var(--space-sm);align-items:center;margin-bottom:var(--space-sm);">
          <span class="session-row-title">${esc(session?.title ?? item.session_id)}</span>
          ${statusBadge(item.category)}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">
          <strong style="color:var(--text-primary);">Next step:</strong> ${esc(item.recommended_next_step)}
        </div>
      </div>
    </a>
  `;
}

function renderSessionRow(session, focusCategoryBySessionId) {
  const queueCount = session.activity?.queue?.count ?? 0;
  const focusCategory = focusCategoryBySessionId.get(session.session_id) ?? null;

  return `
    <a href="#/sessions/${encodeURIComponent(session.session_id)}" class="session-row">
      <div class="card">
        <div class="session-row-top">
          <span class="session-row-title">${esc(session.title)}</span>
          ${statusBadge(session.status)}
          ${focusCategory ? statusBadge(focusCategory) : ""}
          ${priorityLabel(session.priority)}
        </div>
        ${session.objective ? `<div class="session-row-objective">${esc(session.objective)}</div>` : ""}
        <div class="session-row-bottom">
          <div class="metrics">
            <div class="metric-item"><span>Runs</span><span class="metric-value">${session.metrics?.run_count ?? 0}</span></div>
            <div class="metric-item"><span>Queue</span><span class="metric-value">${queueCount}</span></div>
            <div class="metric-item"><span>Failed</span><span class="metric-value">${session.metrics?.failed_run_count ?? 0}</span></div>
            <div class="metric-item"><span>Last active</span><span class="metric-value">${timeAgo(session.metrics?.last_activity_at)}</span></div>
          </div>
          ${session.tags?.length ? `<div class="skill-tags">${session.tags.map((tag) => `<span class="skill-tag">${esc(tag)}</span>`).join("")}</div>` : ""}
        </div>
      </div>
    </a>
  `;
}

function renderDigest(markdown) {
  if (!markdown) {
    return `<em>No digest available.</em>`;
  }

  if (typeof marked !== "undefined" && marked.parse) {
    return marked.parse(markdown);
  }

  return `<pre>${esc(markdown)}</pre>`;
}

import { fetchSessions, fetchFocus } from "../lib/api.js";
import { render, statusBadge, skillTags, priorityLabel, esc, poll } from "../lib/render.js";
import { timeAgo } from "../lib/time.js";

export function mount() {
  render(`<div class="loading">Loading sessions</div>`);

  return poll(async () => {
    try {
      const [sessions, focus] = await Promise.all([fetchSessions(), fetchFocus()]);
      renderPage(sessions, focus);
    } catch (err) {
      render(`<div class="empty-state">Failed to load sessions: ${esc(err.message)}</div>`);
    }
  }, 10_000);
}

function renderPage(sessions, focus) {
  if (sessions.length === 0) {
    render(`
      <div class="empty-state">
        No sessions yet. Use <code>/adopt</code> in OpenClaw to create one.
      </div>
    `);
    return;
  }

  const focusIds = new Set(focus.map(f => f.session_id));

  // Sort: attention items first, then by last_activity_at
  const sorted = [...sessions].sort((a, b) => {
    const aFocus = focusIds.has(a.session_id) ? 1 : 0;
    const bFocus = focusIds.has(b.session_id) ? 1 : 0;
    if (bFocus !== aFocus) return bFocus - aFocus;
    return (b.metrics?.last_activity_at ?? "").localeCompare(a.metrics?.last_activity_at ?? "");
  });

  const focusHtml = focus.length > 0 ? `
    <div class="section-header" style="color: var(--color-waiting);">
      ⚠ Needs Attention (${focus.length})
    </div>
    ${focus.map(f => {
      const s = sessions.find(s => s.session_id === f.session_id);
      const borderColor = f.category === 'waiting_human' ? 'waiting' : f.category === 'blocked' ? 'blocked' : 'stale';
      return `
        <a href="#/sessions/${encodeURIComponent(f.session_id)}" class="session-row">
          <div class="card" style="border-left: 3px solid var(--color-${borderColor}); background: linear-gradient(90deg, rgba(${borderColor === 'waiting' ? '210, 153, 34' : borderColor === 'blocked' ? '248, 81, 73' : '210, 153, 34'}, 0.05) 0%, transparent 100%);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom: var(--space-sm);">
              <span class="session-row-title">${esc(s?.title ?? f.session_id)}</span>
              ${statusBadge(f.category)}
            </div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">
              <strong style="color:var(--text-primary);">Next step:</strong> ${esc(f.recommended_next_step)}
            </div>
            ${f.urgency ? `<div style="margin-top:var(--space-xs);"><span class="badge priority-${f.urgency}" style="font-size:10px;padding:1px 6px;">${f.urgency}</span></div>` : ''}
          </div>
        </a>`;
    }).join("")}
  ` : "";

  render(`
    ${focusHtml}
    <div class="section-header" style="margin-top:${focus.length > 0 ? 'var(--space-xl)' : '0'}">
      All Sessions (${sessions.length})
    </div>
    ${sorted.map(s => renderSessionRow(s)).join("")}
  `);
}

function renderSessionRow(s) {
  const activity = s.activity ?? {};
  const runState = activity.run?.state ?? "idle";
  const runPhase = activity.run?.phase ?? "idle";
  const queueCount = activity.queue?.count ?? 0;
  const skills = s.activity?.run?.phase === "idle" ? [] : []; // Will be populated from detail

  return `
    <a href="#/sessions/${encodeURIComponent(s.session_id)}" class="session-row">
      <div class="card">
        <div class="session-row-top">
          <span class="session-row-title">${esc(s.title)}</span>
          ${statusBadge(s.status)}
          ${runState === "running" ? statusBadge("running") : ""}
          ${priorityLabel(s.priority)}
        </div>
        ${s.objective ? `<div class="session-row-objective">${esc(s.objective)}</div>` : ""}
        <div class="session-row-bottom">
          <div class="metrics">
            <div class="metric-item">
              <span>Runs</span>
              <span class="metric-value">${s.metrics?.run_count ?? 0}</span>
            </div>
            <div class="metric-item">
              <span>Failed</span>
              <span class="metric-value" style="${(s.metrics?.failed_run_count ?? 0) > 0 ? 'color:var(--color-blocked)' : ''}">${s.metrics?.failed_run_count ?? 0}</span>
            </div>
            <div class="metric-item">
              <span>Queue</span>
              <span class="metric-value" style="${queueCount > 0 ? 'color:var(--color-desynced)' : ''}">${queueCount}</span>
            </div>
            <div class="metric-item">
              <span>Last active</span>
              <span class="metric-value">${timeAgo(s.metrics?.last_activity_at)}</span>
            </div>
          </div>
          ${s.tags?.length ? `<div class="skill-tags">${s.tags.map(t => `<span class="skill-tag">${esc(t)}</span>`).join("")}</div>` : ""}
        </div>
      </div>
    </a>`;
}

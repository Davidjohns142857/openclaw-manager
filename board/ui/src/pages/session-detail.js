import { fetchSessionDetail, fetchSessionTimeline } from "../lib/api.js";
import {
  render,
  statusBadge,
  priorityLabel,
  renderMarkdown,
  esc,
  poll
} from "../lib/render.js";
import { timeAgo, duration, shortIso } from "../lib/time.js";

export function mount({ session_id }) {
  render(`<div class="loading">Loading session</div>`);
  return poll(() => load(session_id), 5_000);
}

async function load(sessionId) {
  try {
    const [detail, timeline] = await Promise.all([
      fetchSessionDetail(sessionId),
      fetchSessionTimeline(sessionId)
    ]);
    renderDetail(detail, timeline);
  } catch (error) {
    render(`<div class="empty-state">Failed to load session: ${esc(error.message)}</div>`);
  }
}

function renderDetail({ session, run, checkpoint, summary }, timeline) {
  render(`
    <div style="margin-bottom:var(--space-lg);font-size:12px;color:var(--text-tertiary);">
      <a href="#/">Sessions</a> / ${esc(session.title)}
    </div>

    <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);flex-wrap:wrap;">
      <h1 style="font-size:20px;font-weight:700;">${esc(session.title)}</h1>
      ${statusBadge(session.status)}
      ${priorityLabel(session.priority)}
    </div>

    <div class="card" style="margin-bottom:var(--space-xl);font-size:13px;color:var(--text-secondary);">
      Read-only board. Continue this task in chat with commands such as <code>/resume</code>, <code>/checkpoint</code>, or <code>/close</code>.
    </div>

    <div class="detail-grid">
      <div>
        <div class="card">
          <div class="section-header">Session State</div>
          <ul class="data-list">
            <li class="data-item"><span class="data-key">Objective</span><span class="data-value" style="max-width:60%;text-align:right;">${esc(session.objective)}</span></li>
            <li class="data-item"><span class="data-key">Phase</span><span class="data-value">${esc(session.state?.phase ?? "—")}</span></li>
            <li class="data-item"><span class="data-key">Goal Status</span><span class="data-value">${esc(session.state?.goal_status ?? "—")}</span></li>
            <li class="data-item"><span class="data-key">Session ID</span><span class="data-value">${esc(session.session_id)}</span></li>
            <li class="data-item"><span class="data-key">Created</span><span class="data-value">${shortIso(session.created_at)}</span></li>
            <li class="data-item"><span class="data-key">Last Active</span><span class="data-value">${timeAgo(session.metrics?.last_activity_at)}</span></li>
          </ul>
        </div>

        ${renderDecisionCard(session.state?.pending_human_decisions ?? [])}
        ${renderBlockerCard(session.state?.blockers ?? [])}

        <div class="card">
          <div class="section-header">Next Actions</div>
          <div style="font-size:13px;">
            <div style="margin-bottom:var(--space-sm);color:var(--text-secondary);">Machine:</div>
            ${renderActionList(session.state?.next_machine_actions)}
            <div style="margin-top:var(--space-md);margin-bottom:var(--space-sm);color:var(--text-secondary);">Human:</div>
            ${renderActionList(session.state?.next_human_actions)}
          </div>
        </div>
      </div>

      <div>
        ${run ? renderRunCard(run) : `<div class="card"><div class="section-header">No active run</div><div style="color:var(--text-tertiary);font-size:13px;">Resume this session from chat when you want execution to continue.</div></div>`}

        <div class="card">
          <div class="section-header">Metrics</div>
          <div class="metrics" style="flex-wrap:wrap;">
            <div class="metric-item"><span>Total Runs</span><span class="metric-value">${session.metrics?.run_count ?? 0}</span></div>
            <div class="metric-item"><span>Failed</span><span class="metric-value">${session.metrics?.failed_run_count ?? 0}</span></div>
            <div class="metric-item"><span>Human Interventions</span><span class="metric-value">${session.metrics?.human_intervention_count ?? 0}</span></div>
            <div class="metric-item"><span>Artifacts</span><span class="metric-value">${session.metrics?.artifact_count ?? 0}</span></div>
          </div>
        </div>

        ${summary ? `<div class="card"><div class="section-header">Summary</div><div class="markdown-body">${renderMarkdown(summary)}</div></div>` : ""}

        ${checkpoint ? `
          <div class="card">
            <div class="section-header">Checkpoint</div>
            <ul class="data-list">
              <li class="data-item"><span class="data-key">Run</span><span class="data-value">${esc(checkpoint.run_id)}</span></li>
              <li class="data-item"><span class="data-key">Status</span><span class="data-value">${esc(checkpoint.session_status)}</span></li>
              <li class="data-item"><span class="data-key">Created</span><span class="data-value">${shortIso(checkpoint.created_at)}</span></li>
            </ul>
          </div>
        ` : ""}

        ${renderRunHistory(session.session_id, timeline?.runs ?? [])}
      </div>
    </div>
  `);
}

function renderDecisionCard(decisions) {
  if (!decisions.length) {
    return "";
  }

  return `
    <div class="card">
      <div class="section-header">Pending Decisions (${decisions.length})</div>
      ${decisions
        .map(
          (decision) => `
            <div style="padding:var(--space-sm) 0;border-bottom:1px solid var(--border-subtle);font-size:13px;">
              ${statusBadge("waiting_human")}
              <span style="margin-left:var(--space-sm);">${esc(decision.summary)}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderBlockerCard(blockers) {
  if (!blockers.length) {
    return "";
  }

  return `
    <div class="card">
      <div class="section-header">Blockers (${blockers.length})</div>
      ${blockers
        .map(
          (blocker) => `
            <div style="padding:var(--space-sm) 0;border-bottom:1px solid var(--border-subtle);font-size:13px;">
              ${statusBadge("blocked")}
              <span style="margin-left:var(--space-sm);">${esc(blocker.summary)}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderActionList(actions) {
  return actions?.length
    ? actions
        .map(
          (action) =>
            `<div style="padding:2px 0;font-family:var(--font-mono);font-size:12px;">→ ${esc(action)}</div>`
        )
        .join("")
    : `<div style="color:var(--text-tertiary);">none</div>`;
}

function renderRunCard(run) {
  return `
    <a href="#/sessions/${encodeURIComponent(run.session_id)}/runs/${encodeURIComponent(run.run_id)}" style="color:inherit;text-decoration:none;">
      <div class="card" style="cursor:pointer;">
        <div class="card-header">
          <div class="section-header" style="margin-bottom:0;border-bottom:none;padding-bottom:0;">Current Run</div>
          ${statusBadge(run.status)}
        </div>
        <ul class="data-list">
          <li class="data-item"><span class="data-key">Run ID</span><span class="data-value">${esc(run.run_id)}</span></li>
          <li class="data-item"><span class="data-key">Trigger</span><span class="data-value">${esc(run.trigger?.trigger_type ?? "—")}</span></li>
          <li class="data-item"><span class="data-key">Duration</span><span class="data-value">${duration(run.metrics?.duration_ms)}</span></li>
          <li class="data-item"><span class="data-key">Started</span><span class="data-value">${timeAgo(run.started_at)}</span></li>
        </ul>
        ${run.outcome?.summary ? `<div style="margin-top:var(--space-md);font-size:12px;color:var(--text-secondary);border-top:1px solid var(--border-subtle);padding-top:var(--space-sm);">${esc(run.outcome.summary)}</div>` : ""}
        <div style="margin-top:var(--space-sm);font-size:11px;color:var(--text-tertiary);">Open run timeline →</div>
      </div>
    </a>
  `;
}

function renderRunHistory(sessionId, runs) {
  if (!runs.length) {
    return "";
  }

  return `
    <div class="card">
      <div class="section-header">Run History (${runs.length})</div>
      ${runs
        .map(
          (entry) => `
            <a href="#/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(entry.run_id)}" style="display:block;padding:var(--space-sm) 0;border-bottom:1px solid var(--border-subtle);text-decoration:none;color:inherit;">
              <div style="display:flex;justify-content:space-between;gap:var(--space-sm);align-items:center;">
                <div style="min-width:0;">
                  <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-primary);">${esc(entry.run_id)}</div>
                  <div style="font-size:12px;color:var(--text-secondary);">
                    ${esc(entry.trigger?.trigger_type ?? "unknown")} · ${timeAgo(entry.started_at)}
                  </div>
                </div>
                <div style="display:flex;gap:var(--space-xs);align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                  ${statusBadge(entry.status)}
                  ${entry.outcome?.result_type ? `<span class="skill-tag">${esc(entry.outcome.result_type)}</span>` : ""}
                </div>
              </div>
            </a>
          `
        )
        .join("")}
    </div>
  `;
}

import {
  fetchSessionDetail,
  fetchSessionTimeline,
  resumeSession,
  checkpointSession,
  closeSession
} from "../lib/api.js";
import { render, statusBadge, skillTags, priorityLabel, renderMarkdown, esc, poll, onClick } from "../lib/render.js";
import { timeAgo, duration, shortIso } from "../lib/time.js";

export function mount({ session_id }) {
  render(`<div class="loading">Loading session</div>`);

  const stop = poll(() => load(session_id), 5_000);

  // Wire up action buttons (event delegation)
  const stopClicks = onClick("[data-action]", async (btn) => {
    const action = btn.dataset.action;
    btn.disabled = true;
    btn.textContent = "...";
    try {
      if (action === "resume") await resumeSession(session_id);
      if (action === "checkpoint") await checkpointSession(session_id);
      if (action === "close") await closeSession(session_id);
      await load(session_id);
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    }
  });

  return () => {
    stop();
    stopClicks();
  };
}

async function load(sessionId) {
  try {
    const [detail, timeline] = await Promise.all([
      fetchSessionDetail(sessionId),
      fetchSessionTimeline(sessionId)
    ]);
    renderDetail(detail, timeline);
  } catch (err) {
    render(`<div class="empty-state">Failed to load session: ${esc(err.message)}</div>`);
  }
}

function renderDetail({ session: s, run, checkpoint, summary }, timeline) {
  const activity = s.activity ?? {};

  render(`
    <!-- Breadcrumb -->
    <div style="margin-bottom:var(--space-lg);font-size:12px;color:var(--text-tertiary);">
      <a href="#/">Sessions</a> / ${esc(s.title)}
    </div>

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);flex-wrap:wrap;">
      <h1 style="font-size:20px;font-weight:700;">${esc(s.title)}</h1>
      ${statusBadge(s.status)}
      ${priorityLabel(s.priority)}
      ${s.tags?.map(t => `<span class="skill-tag">${esc(t)}</span>`).join("") ?? ""}
    </div>

    <!-- Actions -->
    <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-xl);">
      <button class="btn btn-primary" data-action="resume">▶ Resume</button>
      <button class="btn" data-action="checkpoint">⟳ Checkpoint</button>
      <button class="btn btn-danger" data-action="close">✕ Close</button>
    </div>

    <div class="detail-grid">
      <!-- Left: Session State -->
      <div>
        <div class="card">
          <div class="section-header">Session State</div>
          <ul class="data-list">
            <li class="data-item"><span class="data-key">Objective</span><span class="data-value" style="max-width:60%;text-align:right;">${esc(s.objective)}</span></li>
            <li class="data-item"><span class="data-key">Phase</span><span class="data-value">${esc(s.state?.phase)}</span></li>
            <li class="data-item"><span class="data-key">Goal Status</span><span class="data-value">${esc(s.state?.goal_status)}</span></li>
            <li class="data-item"><span class="data-key">Session ID</span><span class="data-value">${esc(s.session_id)}</span></li>
            <li class="data-item"><span class="data-key">Created</span><span class="data-value">${shortIso(s.created_at)}</span></li>
            <li class="data-item"><span class="data-key">Last Active</span><span class="data-value">${timeAgo(s.metrics?.last_activity_at)}</span></li>
          </ul>
        </div>

        ${s.state?.blockers?.length ? `
        <div class="card">
          <div class="section-header">Blockers (${s.state.blockers.length})</div>
          ${s.state.blockers.map(b => `
            <div style="padding:var(--space-sm) 0;border-bottom:1px solid var(--border-subtle);font-size:13px;">
              ${statusBadge("blocked")}
              <span style="margin-left:var(--space-sm);">${esc(b.summary)}</span>
              <span style="color:var(--text-tertiary);font-size:11px;margin-left:var(--space-sm);">[${b.severity}]</span>
            </div>
          `).join("")}
        </div>
        ` : ""}

        ${s.state?.pending_human_decisions?.length ? `
        <div class="card">
          <div class="section-header">Pending Decisions (${s.state.pending_human_decisions.length})</div>
          ${s.state.pending_human_decisions.map(d => `
            <div style="padding:var(--space-sm) 0;border-bottom:1px solid var(--border-subtle);font-size:13px;">
              ${statusBadge("waiting_human")}
              <span style="margin-left:var(--space-sm);">${esc(d.summary)}</span>
              <span style="color:var(--text-tertiary);font-size:11px;margin-left:var(--space-sm);">[${d.urgency}]</span>
            </div>
          `).join("")}
        </div>
        ` : ""}

        <div class="card">
          <div class="section-header">Next Actions</div>
          <div style="font-size:13px;">
            <div style="margin-bottom:var(--space-sm);color:var(--text-secondary);">Machine:</div>
            ${s.state?.next_machine_actions?.length
              ? s.state.next_machine_actions.map(a => `<div style="padding:2px 0;font-family:var(--font-mono);font-size:12px;">→ ${esc(a)}</div>`).join("")
              : `<div style="color:var(--text-tertiary);">none</div>`}
            <div style="margin-top:var(--space-md);margin-bottom:var(--space-sm);color:var(--text-secondary);">Human:</div>
            ${s.state?.next_human_actions?.length
              ? s.state.next_human_actions.map(a => `<div style="padding:2px 0;font-family:var(--font-mono);font-size:12px;">→ ${esc(a)}</div>`).join("")
              : `<div style="color:var(--text-tertiary);">none</div>`}
          </div>
        </div>
      </div>

      <!-- Right: Run + Skills + Summary -->
      <div>
        ${run ? renderRunCard(run) : `<div class="card"><div class="section-header">No Active Run</div><div style="color:var(--text-tertiary);font-size:13px;">Use Resume to start a new run.</div></div>`}

        <div class="card">
          <div class="section-header">Metrics</div>
          <div class="metrics" style="flex-wrap:wrap;">
            <div class="metric-item"><span>Total Runs</span><span class="metric-value">${s.metrics?.run_count ?? 0}</span></div>
            <div class="metric-item"><span>Failed</span><span class="metric-value">${s.metrics?.failed_run_count ?? 0}</span></div>
            <div class="metric-item"><span>Human Interventions</span><span class="metric-value">${s.metrics?.human_intervention_count ?? 0}</span></div>
            <div class="metric-item"><span>Artifacts</span><span class="metric-value">${s.metrics?.artifact_count ?? 0}</span></div>
          </div>
        </div>

        ${summary ? `
        <div class="card">
          <div class="section-header">Summary</div>
          <div class="markdown-body">${renderMarkdown(summary)}</div>
        </div>
        ` : ""}

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

        ${renderRunHistory(s.session_id, timeline?.runs ?? [])}
      </div>
    </div>
  `);
}

function renderRunCard(run) {
  return `
    <a href="#/sessions/${encodeURIComponent(run.session_id)}/runs/${encodeURIComponent(run.run_id)}" style="color:inherit;text-decoration:none;">
      <div class="card" style="cursor:pointer;">
        <div class="card-header">
          <div class="section-header" style="margin-bottom:0;border-bottom:none;padding-bottom:0;">
            Current Run
          </div>
          ${statusBadge(run.status)}
        </div>
        <ul class="data-list">
          <li class="data-item"><span class="data-key">Run ID</span><span class="data-value">${esc(run.run_id)}</span></li>
          <li class="data-item"><span class="data-key">Trigger</span><span class="data-value">${esc(run.trigger?.trigger_type)}</span></li>
          <li class="data-item"><span class="data-key">Duration</span><span class="data-value">${duration(run.metrics?.duration_ms)}</span></li>
          <li class="data-item"><span class="data-key">Started</span><span class="data-value">${timeAgo(run.started_at)}</span></li>
        </ul>

        <div class="skill-section">
          <div class="skill-section-header">Skills Used (${run.execution?.invoked_skills?.length ?? 0})</div>
          ${run.execution?.invoked_skills?.length ? skillTags(run.execution.invoked_skills) : '<div style="font-size:11px;color:var(--text-tertiary);">No skills invoked</div>'}
        </div>

        ${run.execution?.invoked_tools?.length ? `
        <div class="skill-section">
          <div class="skill-section-header">Tools Called (${run.execution.invoked_tools.length})</div>
          ${skillTags(run.execution.invoked_tools)}
        </div>
        ` : ""}

        ${run.outcome?.summary ? `
        <div style="margin-top:var(--space-md);font-size:12px;color:var(--text-secondary);border-top:1px solid var(--border-subtle);padding-top:var(--space-sm);">
          ${esc(run.outcome.summary)}
        </div>
        ` : ""}

        <div style="margin-top:var(--space-sm);font-size:11px;color:var(--text-tertiary);">
          Click for full timeline →
        </div>
      </div>
    </a>`;
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
            </a>`
        )
        .join("")}
    </div>
  `;
}

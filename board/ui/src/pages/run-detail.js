import { fetchSessionTimeline } from "../lib/api.js";
import { render, statusBadge, skillTags, esc } from "../lib/render.js";
import { duration, shortIso } from "../lib/time.js";

export function mount({ session_id, run_id }) {
  render(`<div class="loading">Loading run</div>`);
  load(session_id, run_id);
  // No polling on run detail — typically a past run
  return null;
}

async function load(sessionId, runId) {
  try {
    const timeline = await fetchSessionTimeline(sessionId);
    const run = timeline.runs.find((entry) => entry.run_id === runId);

    if (!run) {
      render(
        `<div class="empty-state">Run <code>${esc(runId)}</code> was not found in this session timeline.</div>`
      );
      return;
    }

    renderRun(timeline.session, run);
  } catch (err) {
    render(`<div class="empty-state">Failed to load run: ${esc(err.message)}</div>`);
  }
}

function renderRun(session, run) {
  const recovery = run.recovery ?? {};
  const evidence = run.evidence ?? {};
  const outcome = run.outcome ?? {};
  const statusFlow = Array.isArray(run.status_flow) ? run.status_flow : [];
  const durationMs =
    run.started_at && run.ended_at
      ? Math.max(0, Date.parse(run.ended_at) - Date.parse(run.started_at))
      : null;

  render(`
    <!-- Breadcrumb -->
    <div style="margin-bottom:var(--space-lg);font-size:12px;color:var(--text-tertiary);">
      <a href="#/">Sessions</a> /
      <a href="#/sessions/${encodeURIComponent(session.session_id)}">${esc(session.title)}</a> /
      Run ${esc(run.run_id)}
    </div>

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-xl);">
      <h1 style="font-size:18px;font-weight:700;">Run Detail</h1>
      ${statusBadge(run.status)}
      <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-tertiary);">${esc(run.run_id)}</span>
    </div>

    <div class="detail-grid">
      <!-- Left: Run Info -->
      <div>
        <div class="card">
          <div class="section-header">Execution</div>
          <ul class="data-list">
            <li class="data-item"><span class="data-key">Status</span><span class="data-value">${statusBadge(run.status)}</span></li>
            <li class="data-item"><span class="data-key">Trigger</span><span class="data-value">${esc(run.trigger?.trigger_type)}</span></li>
            <li class="data-item"><span class="data-key">Started</span><span class="data-value">${shortIso(run.started_at)}</span></li>
            <li class="data-item"><span class="data-key">Ended</span><span class="data-value">${run.ended_at ? shortIso(run.ended_at) : "—"}</span></li>
            <li class="data-item"><span class="data-key">Duration</span><span class="data-value">${duration(durationMs)}</span></li>
            <li class="data-item"><span class="data-key">Event Count</span><span class="metric-value">${evidence.event_count ?? 0}</span></li>
            <li class="data-item"><span class="data-key">Skill Traces</span><span class="metric-value">${evidence.skill_trace_count ?? 0}</span></li>
            <li class="data-item"><span class="data-key">Spool Lines</span><span class="metric-value">${evidence.spool_line_count ?? 0}</span></li>
          </ul>
        </div>

        <div class="card">
          <div class="section-header">Outcome</div>
          <ul class="data-list">
            <li class="data-item"><span class="data-key">Result Type</span><span class="data-value">${esc(outcome.result_type ?? "—")}</span></li>
            <li class="data-item"><span class="data-key">Human Takeover</span><span class="data-value">${outcome.human_takeover ? "Yes" : "No"}</span></li>
            <li class="data-item"><span class="data-key">Closure Contribution</span><span class="data-value">${outcome.closure_contribution != null ? `${(outcome.closure_contribution * 100).toFixed(0)}%` : "—"}</span></li>
            ${outcome.reason_code ? `<li class="data-item"><span class="data-key">Reason</span><span class="data-value">${esc(outcome.reason_code)}</span></li>` : ""}
          </ul>
          ${outcome.summary ? `<div style="margin-top:var(--space-md);font-size:13px;color:var(--text-secondary);border-top:1px solid var(--border-subtle);padding-top:var(--space-sm);">${esc(outcome.summary)}</div>` : ""}
        </div>
      </div>

      <!-- Right: Skills + Evidence Refs -->
      <div>
        <div class="card">
          <div class="section-header">Status Flow</div>
          ${statusFlow.length
            ? `<div class="skill-tags">${statusFlow
                .map((entry) => `<span class="skill-tag">${esc(entry.status ?? entry.event_type ?? "unknown")}</span>`)
                .join("")}</div>`
            : `<div style="color:var(--text-tertiary);font-size:13px;">No durable status events recorded.</div>`}
        </div>

        <div class="card">
          <div class="section-header">Skills Used</div>
          ${evidence.invoked_skills?.length
            ? skillTags(evidence.invoked_skills)
            : `<div style="color:var(--text-tertiary);font-size:13px;">No skills invoked in this run.</div>`}
        </div>

        ${evidence.invoked_tools?.length ? `
        <div class="card">
          <div class="section-header">Tools Called</div>
          ${skillTags(evidence.invoked_tools)}
        </div>
        ` : ""}

        <div class="card">
          <div class="section-header">Recovery Refs</div>
          <ul class="data-list">
            <li class="data-item"><span class="data-key">Recovery Checkpoint</span><span class="data-value" style="font-size:11px;">${esc(recovery.recovery_checkpoint_ref ?? "—")}</span></li>
            <li class="data-item"><span class="data-key">End Checkpoint</span><span class="data-value" style="font-size:11px;">${esc(recovery.end_checkpoint_ref ?? "—")}</span></li>
            <li class="data-item"><span class="data-key">Summary Ref</span><span class="data-value" style="font-size:11px;">${esc(recovery.summary_ref ?? "—")}</span></li>
            <li class="data-item"><span class="data-key">Head Advanced</span><span class="data-value">${recovery.terminal_head_advanced ? "Yes" : "No"}</span></li>
          </ul>
        </div>

        <div class="card">
          <div class="section-header">Evidence Files</div>
          <ul class="data-list">
            <li class="data-item"><span class="data-key">Events</span><span class="data-value" style="font-size:11px;">${esc(evidence.events_ref ?? "—")}</span></li>
            <li class="data-item"><span class="data-key">Skill Traces</span><span class="data-value" style="font-size:11px;">${esc(evidence.skill_traces_ref ?? "—")}</span></li>
            <li class="data-item"><span class="data-key">Spool</span><span class="data-value" style="font-size:11px;">${esc(evidence.spool_ref ?? "—")}</span></li>
          </ul>
          ${evidence.artifact_refs?.length ? `
          <div style="margin-top:var(--space-md);">
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:var(--space-xs);">Artifacts</div>
            ${evidence.artifact_refs.map(a => `<div style="font-family:var(--font-mono);font-size:11px;padding:2px 0;">${esc(a)}</div>`).join("")}
          </div>
          ` : ""}
        </div>
      </div>
    </div>
  `);
}

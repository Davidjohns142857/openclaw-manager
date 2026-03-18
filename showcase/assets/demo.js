import { demoSessions, demoRuns, demoFocus, demoSummaries, demoTimelines } from './demo-data.js';

// ── Utility Functions ──────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeAgo(isoString) {
  if (!isoString) return 'never';
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function duration(ms) {
  if (!ms) return 'running...';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ── Render Functions ───────────────────────────────────────────────────────

function statusBadge(status) {
  return `<span class="badge badge-${status}">${status.replace('_', ' ')}</span>`;
}

function priorityLabel(priority) {
  if (!priority) return '';
  return `<span class="priority-${priority}" style="font-size:0.75rem;font-weight:600;">◆ ${priority.toUpperCase()}</span>`;
}

function renderSessionCard(session) {
  const runState = session.activity?.run?.state ?? 'idle';

  return `
    <a href="#" class="session-card" data-session-id="${esc(session.session_id)}">
      <div class="session-card-header">
        <span class="session-title">${esc(session.title)}</span>
        ${statusBadge(session.status)}
        ${runState === 'running' ? statusBadge('running') : ''}
        ${priorityLabel(session.priority)}
      </div>
      <div class="session-objective">${esc(session.objective)}</div>
      <div class="session-footer">
        <div class="metrics">
          <div class="metric-item">
            <span>Runs</span>
            <span class="metric-value">${session.metrics?.run_count ?? 0}</span>
          </div>
          <div class="metric-item">
            <span>Failed</span>
            <span class="metric-value" style="${(session.metrics?.failed_run_count ?? 0) > 0 ? 'color:var(--color-blocked)' : ''}">${session.metrics?.failed_run_count ?? 0}</span>
          </div>
          <div class="metric-item">
            <span>Last active</span>
            <span class="metric-value">${timeAgo(session.metrics?.last_activity_at)}</span>
          </div>
        </div>
        ${session.tags?.length ? `<div class="tags">${session.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </a>
  `;
}

function renderFocusCard(focusItem) {
  const session = demoSessions.find(s => s.session_id === focusItem.session_id);
  const borderColor = focusItem.category === 'waiting_human' ? 'waiting' : 'blocked';

  return `
    <a href="#" class="session-card" data-session-id="${esc(focusItem.session_id)}" style="border-left: 3px solid var(--color-${borderColor});">
      <div class="session-card-header">
        <span class="session-title">${esc(session?.title ?? focusItem.session_id)}</span>
        ${statusBadge(focusItem.category)}
        <span class="priority-${focusItem.urgency}" style="font-size:0.75rem;font-weight:600;">◆ ${focusItem.urgency.toUpperCase()}</span>
      </div>
      <div class="session-objective" style="color:var(--text-secondary);font-size:0.85rem;">
        <strong style="color:var(--text-primary);">Next step:</strong> ${esc(focusItem.recommended_next_step)}
      </div>
      <div class="session-footer">
        <div style="font-size:0.75rem;color:var(--text-tertiary);">
          Priority score: ${focusItem.attention_priority}
        </div>
      </div>
    </a>
  `;
}

function renderSessionDetail(sessionId) {
  const session = demoSessions.find(s => s.session_id === sessionId);
  if (!session) return '<p>Session not found</p>';

  const run = demoRuns[sessionId];
  const summary = demoSummaries[sessionId];

  return `
    <h2 style="font-size:1.75rem;margin-bottom:var(--space-lg);">${esc(session.title)}</h2>
    <div style="display:flex;gap:var(--space-md);margin-bottom:var(--space-xl);flex-wrap:wrap;">
      ${statusBadge(session.status)}
      ${priorityLabel(session.priority)}
      ${session.tags?.map(t => `<span class="tag">${esc(t)}</span>`).join('') ?? ''}
    </div>

    <div class="detail-grid">
      <!-- Left: Session Info -->
      <div>
        <div class="info-card">
          <div class="section-header">Session State</div>
          <div class="info-row">
            <span class="info-label">Objective</span>
            <span class="info-value" style="max-width:60%;text-align:right;word-break:break-word;">${esc(session.objective)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Phase</span>
            <span class="info-value">${esc(session.state?.phase)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Goal Status</span>
            <span class="info-value">${esc(session.state?.goal_status)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Last Activity</span>
            <span class="info-value">${timeAgo(session.metrics?.last_activity_at)}</span>
          </div>
        </div>

        ${session.state?.blockers?.length ? `
        <div class="info-card" style="margin-top:var(--space-md);">
          <div class="section-header">Blockers (${session.state.blockers.length})</div>
          ${session.state.blockers.map(b => `
            <div style="padding:var(--space-sm) 0;border-bottom:1px solid var(--border-subtle);font-size:0.85rem;">
              ${statusBadge('blocked')}
              <span style="margin-left:var(--space-sm);">${esc(b.summary)}</span>
            </div>
          `).join('')}
        </div>
        ` : ''}

        ${session.state?.pending_human_decisions?.length ? `
        <div class="info-card" style="margin-top:var(--space-md);">
          <div class="section-header">Pending Decisions (${session.state.pending_human_decisions.length})</div>
          ${session.state.pending_human_decisions.map(d => `
            <div style="padding:var(--space-sm) 0;border-bottom:1px solid var(--border-subtle);font-size:0.85rem;">
              ${statusBadge('waiting_human')}
              <span style="margin-left:var(--space-sm);">${esc(d.summary)}</span>
            </div>
          `).join('')}
        </div>
        ` : ''}

        <div class="info-card" style="margin-top:var(--space-md);">
          <div class="section-header">Next Actions</div>
          <div style="font-size:0.85rem;">
            <div style="margin-bottom:var(--space-xs);color:var(--text-secondary);">Machine:</div>
            ${session.state?.next_machine_actions?.length
              ? session.state.next_machine_actions.map(a => `<div style="padding:2px 0;font-family:var(--font-mono);font-size:0.75rem;">→ ${esc(a)}</div>`).join('')
              : `<div style="color:var(--text-tertiary);font-size:0.8rem;">none</div>`}
            <div style="margin-top:var(--space-sm);margin-bottom:var(--space-xs);color:var(--text-secondary);">Human:</div>
            ${session.state?.next_human_actions?.length
              ? session.state.next_human_actions.map(a => `<div style="padding:2px 0;font-family:var(--font-mono);font-size:0.75rem;">→ ${esc(a)}</div>`).join('')
              : `<div style="color:var(--text-tertiary);font-size:0.8rem;">none</div>`}
          </div>
        </div>
      </div>

      <!-- Right: Run + Summary -->
      <div>
        ${run ? `
        <div class="info-card">
          <div class="section-header">Current Run</div>
          ${statusBadge(run.status)}
          <div class="info-row" style="margin-top:var(--space-md);">
            <span class="info-label">Run ID</span>
            <span class="info-value">${esc(run.run_id)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Trigger</span>
            <span class="info-value">${esc(run.trigger?.trigger_type)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Duration</span>
            <span class="info-value">${duration(run.metrics?.duration_ms)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Started</span>
            <span class="info-value">${timeAgo(run.started_at)}</span>
          </div>

          <div style="margin-top:var(--space-md);">
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:var(--space-xs);">Skills Used (${run.execution?.invoked_skills?.length ?? 0})</div>
            ${run.execution?.invoked_skills?.length ? `
              <div class="skill-tags">
                ${run.execution.invoked_skills.map(s => `<span class="skill-tag">${esc(s)}</span>`).join('')}
              </div>
            ` : '<div style="font-size:0.75rem;color:var(--text-tertiary);">No skills invoked</div>'}
          </div>

          ${run.execution?.invoked_tools?.length ? `
          <div style="margin-top:var(--space-sm);">
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:var(--space-xs);">Tools Called (${run.execution.invoked_tools.length})</div>
            <div class="skill-tags">
              ${run.execution.invoked_tools.map(t => `<span class="skill-tag">${esc(t)}</span>`).join('')}
            </div>
          </div>
          ` : ''}

          ${run.outcome?.summary ? `
          <div style="margin-top:var(--space-md);font-size:0.85rem;color:var(--text-secondary);border-top:1px solid var(--border-subtle);padding-top:var(--space-sm);">
            ${esc(run.outcome.summary)}
          </div>
          ` : ''}
        </div>
        ` : '<div class="info-card"><div class="section-header">No Active Run</div><p style="color:var(--text-tertiary);font-size:0.85rem;">This session is idle.</p></div>'}

        ${summary ? `
        <div class="info-card" style="margin-top:var(--space-md);">
          <div class="section-header">Summary</div>
          <div style="font-size:0.85rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;">${esc(summary)}</div>
        </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ── Public Facts Loader ────────────────────────────────────────────────────

async function loadPublicFacts() {
  const container = document.getElementById('public-facts-list');

  try {
    const response = await fetch('/api/v1/facts?limit=10');
    const data = await response.json();

    if (data.facts && data.facts.length > 0) {
      container.innerHTML = data.facts.map(fact => `
        <div class="fact-item">
          <div class="fact-header">
            <span>${esc(fact.skill_name || 'Unknown Skill')}</span>
            <span class="fact-meta">${fact.scenario_signature || 'N/A'}</span>
          </div>
          <div class="fact-meta">
            ${fact.outcome_type || 'N/A'} ·
            ${fact.usage_count || 0} uses ·
            ${timeAgo(fact.captured_at)}
          </div>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<p style="color:var(--text-tertiary);text-align:center;padding:var(--space-xl);">No facts available yet.</p>';
    }
  } catch (error) {
    console.error('Failed to load public facts:', error);
    container.innerHTML = `
      <div style="text-align:center;padding:var(--space-xl);color:var(--text-tertiary);">
        <p>Failed to connect to public ingest server.</p>
        <p style="font-size:0.85rem;margin-top:var(--space-sm);">The live API may be offline. This is demo data anyway.</p>
      </div>
    `;
  }
}

// ── Tab Switching ──────────────────────────────────────────────────────────

function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`tab-${target}`).classList.add('active');

      // Load public facts when switching to that tab
      if (target === 'public-facts') {
        loadPublicFacts();
      }
    });
  });
}

// ── Modal ──────────────────────────────────────────────────────────────────

window.openModal = function(sessionId) {
  const modal = document.getElementById('session-modal');
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = renderSessionDetail(sessionId);
  modal.classList.add('active');
};

window.closeModal = function() {
  document.getElementById('session-modal').classList.remove('active');
};

// Close modal on click outside
document.getElementById('session-modal').addEventListener('click', (e) => {
  if (e.target.id === 'session-modal') {
    closeModal();
  }
});

// ── Initialize ─────────────────────────────────────────────────────────────

function init() {
  // Render sessions
  const sessionList = document.getElementById('session-list');
  sessionList.innerHTML = demoSessions.map(s => renderSessionCard(s)).join('');

  // Render focus
  const focusList = document.getElementById('tab-focus');
  const focusContainer = document.createElement('div');
  focusContainer.className = 'session-list';
  focusContainer.innerHTML = demoFocus.map(f => renderFocusCard(f)).join('');
  focusList.appendChild(focusContainer);

  // Add click handlers to session cards
  document.querySelectorAll('.session-card').forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const sessionId = card.dataset.sessionId;
      openModal(sessionId);
    });
  });

  // Initialize tabs
  initTabs();
}

init();

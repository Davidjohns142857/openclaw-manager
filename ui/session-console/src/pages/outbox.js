import { fetchHealth, fetchOutboxBatches, submitPublicFacts } from "../lib/api.js";
import { render, esc, onClick, poll } from "../lib/render.js";
import { shortIso, timeAgo } from "../lib/time.js";

export function mount() {
  render(`<div class="loading">Loading outbox status</div>`);

  const stopPoll = poll(async () => {
    try {
      const [health, batches] = await Promise.all([fetchHealth(), fetchOutboxBatches()]);
      renderOutbox(health, batches);
    } catch (err) {
      render(`<div class="empty-state">Failed to load: ${esc(err.message)}</div>`);
    }
  }, 15_000);

  const stopClicks = onClick("[data-submit-mode]", async (button) => {
    const mode = button.dataset.submitMode;
    if (!mode) {
      return;
    }

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "...";

    try {
      await submitPublicFacts(mode);
    } catch (error) {
      alert(`Submit failed: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  return () => {
    stopPoll();
    stopClicks();
  };
}

function renderOutbox(health, batches) {
  const counts = countByState(batches);
  const autoSubmit = health.public_facts?.auto_submit ?? {};
  const consoleUrl = health.ui?.session_console_url ?? "/ui";

  render(`
    <div class="section-header">Public Facts Outbox</div>

    <div class="card">
      <div class="section-header">Sidecar Status</div>
      <ul class="data-list">
        <li class="data-item"><span class="data-key">Status</span><span class="data-value" style="color:var(--color-active);">${esc(health.status)}</span></li>
        <li class="data-item"><span class="data-key">Sessions</span><span class="data-value">${health.session_count ?? 0}</span></li>
        <li class="data-item"><span class="data-key">Port</span><span class="data-value">${health.port ?? "—"}</span></li>
        <li class="data-item"><span class="data-key">Console</span><span class="data-value"><a href="${esc(consoleUrl)}">${esc(consoleUrl)}</a></span></li>
      </ul>
    </div>

    <div class="card">
      <div class="section-header">Outbox Status</div>
      <div class="metrics" style="flex-wrap:wrap;">
        <div class="metric-item"><span>Pending</span><span class="metric-value">${counts.pending}</span></div>
        <div class="metric-item"><span>Claimed</span><span class="metric-value">${counts.claimed}</span></div>
        <div class="metric-item"><span>Acked</span><span class="metric-value">${counts.acked}</span></div>
        <div class="metric-item"><span>Retryable</span><span class="metric-value">${counts.failed_retryable}</span></div>
        <div class="metric-item"><span>Dead Letter</span><span class="metric-value">${counts.dead_letter}</span></div>
      </div>
      <div style="margin-top:var(--space-md);display:flex;gap:var(--space-sm);flex-wrap:wrap;">
        <button class="btn btn-primary" data-submit-mode="http">Submit HTTP</button>
        <button class="btn" data-submit-mode="dry-run">Dry Run</button>
      </div>
    </div>

    <div class="card">
      <div class="section-header">Auto Submit</div>
      <ul class="data-list">
        <li class="data-item"><span class="data-key">Enabled</span><span class="data-value">${autoSubmit.enabled ? "Yes" : "No"}</span></li>
        <li class="data-item"><span class="data-key">Interval</span><span class="data-value">${autoSubmit.interval_ms ?? "—"} ms</span></li>
        <li class="data-item"><span class="data-key">Last Tick</span><span class="data-value">${autoSubmit.last_tick_at ? shortIso(autoSubmit.last_tick_at) : "—"}</span></li>
        <li class="data-item"><span class="data-key">Last Success</span><span class="data-value">${autoSubmit.last_success_at ? shortIso(autoSubmit.last_success_at) : "—"}</span></li>
        <li class="data-item"><span class="data-key">Last Error</span><span class="data-value">${esc(autoSubmit.last_error ?? "—")}</span></li>
      </ul>
    </div>

    <div class="card">
      <div class="section-header">Batches (${batches.length})</div>
      ${batches.length
        ? batches.map(renderBatchRow).join("")
        : `<div style="color:var(--text-tertiary);font-size:13px;">No outbox batches yet. Close sessions and let distillation or auto-submit populate the outbox.</div>`}
    </div>

    <div class="card">
      <div class="section-header">Public Ingest Server</div>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;">
        <div><strong>Endpoint:</strong> ${esc(health.public_facts?.endpoint ?? "—")}</div>
        <div><strong>Schema:</strong> ${esc(health.public_facts?.schema_version ?? "—")}</div>
      </div>
    </div>
  `);
}

function renderBatchRow(batch) {
  return `
    <div style="padding:var(--space-sm) 0;border-bottom:1px solid var(--border-subtle);">
      <div style="display:flex;justify-content:space-between;gap:var(--space-sm);align-items:center;flex-wrap:wrap;">
        <div style="min-width:0;">
          <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-primary);">${esc(batch.batch_id)}</div>
          <div style="font-size:12px;color:var(--text-secondary);">
            ${batch.fact_count} facts · ${esc(batch.transport_mode ?? "unsubmitted")} · updated ${timeAgo(batch.updated_at)}
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);">
            created ${shortIso(batch.created_at)} · last receipt ${esc(batch.last_receipt_id ?? "—")}
          </div>
        </div>
        <div style="display:flex;gap:var(--space-xs);align-items:center;flex-wrap:wrap;">
          <span class="skill-tag">${esc(batch.state)}</span>
          <span class="skill-tag">attempts ${batch.attempt_count ?? 0}</span>
        </div>
      </div>
    </div>
  `;
}

function countByState(batches) {
  const counts = {
    pending: 0,
    claimed: 0,
    acked: 0,
    failed_retryable: 0,
    dead_letter: 0
  };

  for (const batch of batches) {
    if (batch?.state in counts) {
      counts[batch.state] += 1;
    }
  }

  return counts;
}

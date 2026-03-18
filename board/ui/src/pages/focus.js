import { fetchDigest, fetchFocus, fetchSessions } from "../lib/api.js";
import { render, esc, poll, statusBadge } from "../lib/render.js";
import { timeAgo } from "../lib/time.js";

export function mount() {
  render(`<div class="loading">Loading focus queue</div>`);

  return poll(async () => {
    try {
      const [focus, sessions, digest] = await Promise.all([
        fetchFocus(),
        fetchSessions(),
        fetchDigest()
      ]);
      renderFocus(focus, sessions, digest);
    } catch (error) {
      render(
        `<div class="empty-state">Failed to load focus queue: ${esc(error.message)}</div>`
      );
    }
  }, 10_000);
}

function renderFocus(focus, sessions, digest) {
  const sessionById = new Map(sessions.map((session) => [session.session_id, session]));

  render(`
    <div class="section-header">Focus Queue</div>

    <div class="card" style="margin-bottom:var(--space-lg);">
      <div class="section-header">Digest</div>
      <div class="markdown-body">${renderDigest(digest.digest)}</div>
    </div>

    ${
      focus.length === 0
        ? `<div class="empty-state">No urgent focus items right now.</div>`
        : focus
            .map((item) => {
              const session = sessionById.get(item.session_id);
              return `
                <a href="#/sessions/${encodeURIComponent(item.session_id)}" class="session-row">
                  <div class="card">
                    <div class="session-row-top">
                      <span class="session-row-title">${esc(session?.title ?? item.session_id)}</span>
                      ${statusBadge(item.category)}
                    </div>
                    <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;">
                      <div><strong>Reason:</strong> ${esc(item.reasoning_summary ?? "—")}</div>
                      <div><strong>Next step:</strong> ${esc(item.recommended_next_step ?? "Review in chat")}</div>
                    </div>
                    <div class="session-row-bottom" style="margin-top:var(--space-md);">
                      <div class="metrics">
                        <div class="metric-item"><span>Urgency</span><span class="metric-value">${esc(item.urgency ?? "—")}</span></div>
                        <div class="metric-item"><span>Confidence</span><span class="metric-value">${Math.round((item.confidence ?? 0) * 100)}%</span></div>
                        <div class="metric-item"><span>Created</span><span class="metric-value">${timeAgo(item.created_at)}</span></div>
                      </div>
                    </div>
                  </div>
                </a>
              `;
            })
            .join("")
    }
  `);
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

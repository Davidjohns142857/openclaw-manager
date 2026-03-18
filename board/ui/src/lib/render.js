// Minimal DOM helpers. No virtual DOM, just innerHTML + event delegation.

const app = () => document.getElementById("app");

export function render(html) {
  app().innerHTML = html;
}

export function $(selector) {
  return app().querySelector(selector);
}

export function $$(selector) {
  return [...app().querySelectorAll(selector)];
}

export function onClick(selector, handler) {
  const listener = (e) => {
    const target = e.target.closest(selector);
    if (target) handler(target, e);
  };

  app().addEventListener("click", listener);
  return () => app().removeEventListener("click", listener);
}

export function statusBadge(status) {
  const cls = `badge badge-${status}`;
  return `<span class="${cls}">${status.replace("_", " ")}</span>`;
}

export function priorityLabel(priority) {
  return `<span class="priority-${priority}">${priority}</span>`;
}

export function skillTags(skills) {
  if (!skills || skills.length === 0) return `<span class="text-tertiary">none</span>`;
  return `<div class="skill-tags">${skills.map(s => `<span class="skill-tag">${esc(s)}</span>`).join("")}</div>`;
}

export function renderMarkdown(md) {
  if (!md) return "<em>No summary available.</em>";
  if (typeof marked !== "undefined" && marked.parse) {
    return marked.parse(md);
  }
  // Fallback: just show as preformatted text
  return `<pre>${esc(md)}</pre>`;
}

export function esc(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Polling helper: returns a stop function
export function poll(fn, intervalMs) {
  fn(); // immediate first call
  const id = setInterval(fn, intervalMs);
  return () => clearInterval(id);
}

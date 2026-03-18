import * as router from "./lib/router.js";
import { fetchHealth } from "./lib/api.js";
import { mount as mountSessions } from "./pages/sessions.js";
import { mount as mountSessionDetail } from "./pages/session-detail.js";
import { mount as mountRunDetail } from "./pages/run-detail.js";
import { mount as mountOutbox } from "./pages/outbox.js";

// ── Routes ──

router.on("/", () => mountSessions());
router.on("/sessions/:session_id", (params) => mountSessionDetail(params));
router.on("/sessions/:session_id/runs/:run_id", (params) => mountRunDetail(params));
router.on("/outbox", () => mountOutbox());

// ── Sidecar health indicator ──

async function updateHealthIndicator() {
  const el = document.getElementById("sidecar-status");
  try {
    const health = await fetchHealth();
    el.textContent = `● sidecar:${health.port ?? "?"}  sessions:${health.session_count ?? 0}`;
    el.className = "nav-status ok";
  } catch {
    el.textContent = "● sidecar offline";
    el.className = "nav-status err";
  }
}

updateHealthIndicator();
setInterval(updateHealthIndicator, 30_000);

// ── Active nav link highlighting ──

function updateActiveNavLink() {
  const hash = window.location.hash || "#/";
  const links = document.querySelectorAll(".nav-link");
  links.forEach(link => {
    const route = link.getAttribute("data-route");
    if (hash === `#${route}` || (route !== "/" && hash.startsWith(`#${route}`))) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

window.addEventListener("hashchange", updateActiveNavLink);
updateActiveNavLink();

// ── Start ──

router.start();

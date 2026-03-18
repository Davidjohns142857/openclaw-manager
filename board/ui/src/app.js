import * as router from "./lib/router.js";
import { fetchHealth } from "./lib/api.js";
import { mount as mountSessions } from "./pages/sessions.js";
import { mount as mountFocus } from "./pages/focus.js";
import { mount as mountSessionDetail } from "./pages/session-detail.js";
import { mount as mountRunDetail } from "./pages/run-detail.js";

router.on("/", () => mountSessions());
router.on("/focus", () => mountFocus());
router.on("/sessions/:session_id", (params) => mountSessionDetail(params));
router.on("/sessions/:session_id/runs/:run_id", (params) => mountRunDetail(params));

async function updateHealthIndicator() {
  const el = document.getElementById("sidecar-status");
  try {
    const health = await fetchHealth();
    el.textContent = `● ${health.owner_ref ?? "viewer"}  sessions:${health.session_count ?? 0}`;
    el.className = "nav-status ok";
  } catch {
    el.textContent = "● board offline";
    el.className = "nav-status err";
  }
}

updateHealthIndicator();
setInterval(updateHealthIndicator, 30_000);
router.start();

// All API calls to the manager sidecar. Same-origin, no base URL needed.

async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function post(path, body = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

// ── Read ──

export const fetchHealth       = ()   => get("/health");
export const fetchSessions     = ()   => get("/sessions");
export const fetchSessionDetail = (id) => get(`/sessions/${encodeURIComponent(id)}`);
export const fetchSessionTimeline = (id) => get(`/sessions/${encodeURIComponent(id)}/timeline`);
export const fetchFocus        = ()   => get("/focus");
export const fetchDigest       = ()   => get("/digest");
export const fetchBindings     = ()   => get("/bindings");
export const fetchContracts    = ()   => get("/contracts");
export const fetchOutboxBatches = () => get("/public-facts/outbox");
export const fetchOutboxBatch = (batchId) =>
  get(`/public-facts/outbox/${encodeURIComponent(batchId)}`);

// ── Mutate ──

export const resumeSession     = (id) => post(`/sessions/${encodeURIComponent(id)}/resume`);
export const checkpointSession = (id) => post(`/sessions/${encodeURIComponent(id)}/checkpoint`);
export const closeSession      = (id, resolution = "completed") =>
  post(`/sessions/${encodeURIComponent(id)}/close`, { resolution, outcome_summary: `Closed via console (${resolution}).` });
export const adoptSession      = (title, objective) =>
  post("/adopt", { title, objective });
export const submitPublicFacts = (mode = "http") =>
  post("/public-facts/submit", { mode });

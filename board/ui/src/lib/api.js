function boardTokenFromPath() {
  const match = window.location.pathname.match(/^\/board\/([^/]+)/u);
  return match ? decodeURIComponent(match[1]) : null;
}

const TOKEN = boardTokenFromPath();

if (!TOKEN) {
  throw new Error("Viewer board token is missing from the URL.");
}

const API_BASE = `/board-api/${encodeURIComponent(TOKEN)}`;

async function get(path) {
  const response = await fetch(path, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`GET ${path} → ${response.status}`);
  }

  return response.json();
}

export const fetchHealth = () => get(`${API_BASE}/health`);
export const fetchSessions = () => get(`${API_BASE}/sessions`);
export const fetchSessionDetail = (id) =>
  get(`${API_BASE}/sessions/${encodeURIComponent(id)}`);
export const fetchSessionTimeline = (id) =>
  get(`${API_BASE}/sessions/${encodeURIComponent(id)}/timeline`);
export const fetchFocus = () => get(`${API_BASE}/focus`);
export const fetchDigest = () => get(`${API_BASE}/digest`);

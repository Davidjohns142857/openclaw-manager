export function timeAgo(isoString) {
  if (!isoString) return "—";
  const seconds = Math.floor((Date.now() - Date.parse(isoString)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function duration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function shortIso(isoString) {
  if (!isoString) return "—";
  return isoString.replace("T", " ").slice(0, 19);
}

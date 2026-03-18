export const DEFAULT_PUBLISHED_UI_PROXY_PORT = 18891;

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function buildLocalSessionConsoleUrl(port: number): string {
  return `http://127.0.0.1:${port}/ui`;
}

export function buildPublishedSessionConsoleUrl(publicBaseUrl: string | null): string | null {
  if (!publicBaseUrl?.trim()) {
    return null;
  }

  return new URL("ui", normalizeBaseUrl(publicBaseUrl.trim())).toString();
}

export function validatePublishedUiBaseUrl(
  publicBaseUrl: string | null,
  options: {
    manager_base_url: string;
    public_facts_endpoint: string;
  }
): string | null {
  if (!publicBaseUrl?.trim()) {
    return null;
  }

  let published: URL;
  let manager: URL;
  let ingest: URL | null = null;

  try {
    published = new URL(publicBaseUrl);
  } catch {
    return "Published UI base URL must be a valid absolute http(s) URL.";
  }

  if (published.protocol !== "http:" && published.protocol !== "https:") {
    return "Published UI base URL must use http or https.";
  }

  if (isLocalhostHost(published.hostname)) {
    return "Published UI base URL must not point at localhost; keep local admin access on /health -> ui.local_session_console_url.";
  }

  try {
    manager = new URL(options.manager_base_url);
  } catch {
    return "Manager base URL is invalid.";
  }

  try {
    ingest = new URL(options.public_facts_endpoint);
  } catch {
    ingest = null;
  }

  const managerPort = effectivePort(manager);
  const publishedPort = effectivePort(published);
  if (publishedPort === managerPort) {
    return "Published UI base URL must not point at the manager sidecar port; publish through Gateway WebUI / reverse proxy instead of exposing sidecar directly.";
  }

  if (ingest && published.origin === ingest.origin) {
    return "Published UI base URL must stay on a different public origin or port than the ingest service; do not reuse the ingest host:port for user-facing UI.";
  }

  if (/^\/v1\/(ingest|health|facts)\/?$/u.test(published.pathname)) {
    return "Published UI base URL must stay separate from the public ingest API surface.";
  }

  return null;
}

export function derivePublishedUiBaseUrlFromPublicFactsEndpoint(
  publicFactsEndpoint: string,
  publishPort: number = DEFAULT_PUBLISHED_UI_PROXY_PORT
): string | null {
  try {
    const ingest = new URL(publicFactsEndpoint);
    if (isLocalhostHost(ingest.hostname) || !Number.isFinite(publishPort)) {
      return null;
    }

    const published = new URL(`${ingest.protocol}//${ingest.host}`);
    published.port = `${publishPort}`;
    published.pathname = "";
    published.search = "";
    published.hash = "";
    return published.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function effectivePort(url: URL): string {
  if (url.port) {
    return url.port;
  }

  return url.protocol === "https:" ? "443" : "80";
}

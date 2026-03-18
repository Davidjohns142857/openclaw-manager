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

export function isoNow(): string {
  return new Date().toISOString();
}

export function hoursSince(timestamp: string, now: Date = new Date()): number {
  return (now.getTime() - Date.parse(timestamp)) / 3_600_000;
}

export function addHours(timestamp: string, hours: number): string {
  return new Date(Date.parse(timestamp) + hours * 3_600_000).toISOString();
}


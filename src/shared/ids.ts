import { createHash, randomUUID } from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function createCorrelationId(): string {
  return `corr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function createStableId(prefix: string, payload: unknown): string {
  const serialized =
    typeof payload === "string" ? payload : JSON.stringify(sortRecursively(payload));
  const digest = createHash("sha256").update(serialized).digest("hex").slice(0, 16);
  return `${prefix}_${digest}`;
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortRecursively(entry));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortRecursively(entry)])
  );
}

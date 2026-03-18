import type { BoardToken, TokenStore } from "./token-store.ts";

export interface BoardInstallProof {
  sidecar_version: string;
  node_id: string;
  timestamp: string;
  signature: string;
}

export type BoardRegistrationError =
  | "invalid_owner_ref"
  | "invalid_install_proof"
  | "timestamp_too_old"
  | "ip_rate_limit_exceeded";

export class RegistrationRateLimiter {
  readonly maxPerHour: number;
  readonly windowMs: number;
  readonly buckets: Map<string, { count: number; windowStart: number }>;

  constructor(maxPerHour: number = 3, windowMs: number = 3_600_000) {
    this.maxPerHour = maxPerHour;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  tryConsume(key: string, now: number = Date.now()): boolean {
    const existing = this.buckets.get(key);

    if (!existing || now - existing.windowStart > this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (existing.count >= this.maxPerHour) {
      return false;
    }

    existing.count += 1;
    return true;
  }
}

export async function findActiveTokenForOwner(
  tokenStore: TokenStore,
  ownerRef: string
): Promise<BoardToken | null> {
  const now = Date.now();
  const tokens = await tokenStore.list();
  return (
    tokens.find((token) => {
      if (token.owner_ref !== ownerRef || token.revoked) {
        return false;
      }

      return token.expires_at === null || Date.parse(token.expires_at) > now;
    }) ??
    null
  );
}

export function validateRegistrationRequest(
  ownerRef: unknown,
  proof: unknown,
  now: number = Date.now()
): BoardRegistrationError | null {
  if (typeof ownerRef !== "string" || ownerRef.trim().length < 4) {
    return "invalid_owner_ref";
  }

  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return "invalid_install_proof";
  }

  const candidate = proof as Partial<BoardInstallProof>;
  if (
    typeof candidate.sidecar_version !== "string" ||
    candidate.sidecar_version.trim().length === 0 ||
    typeof candidate.node_id !== "string" ||
    !candidate.node_id.startsWith("anon_") ||
    candidate.node_id.trim().length < 8 ||
    typeof candidate.timestamp !== "string" ||
    typeof candidate.signature !== "string" ||
    candidate.signature.trim().length < 16
  ) {
    return "invalid_install_proof";
  }

  const proofAgeMs = now - Date.parse(candidate.timestamp);
  if (!Number.isFinite(proofAgeMs) || proofAgeMs > 300_000 || proofAgeMs < -60_000) {
    return "timestamp_too_old";
  }

  return null;
}

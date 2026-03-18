import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BoardToken {
  token: string;
  owner_ref: string;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
  label: string;
}

export interface TokenStore {
  resolve(token: string): Promise<BoardToken | null>;
  list(): Promise<BoardToken[]>;
  create(ownerRef: string, label?: string, expiresAt?: string | null): Promise<BoardToken>;
  revoke(token: string): Promise<boolean>;
  rotate(oldToken: string): Promise<BoardToken | null>;
}

interface TokenStoreFile {
  tokens: BoardToken[];
}

function isoNow(): string {
  return new Date().toISOString();
}

function generateBoardToken(): string {
  return `bt_${randomBytes(24).toString("base64url")}`;
}

function isTokenExpired(token: BoardToken, now: number = Date.now()): boolean {
  return token.expires_at !== null && Number.isFinite(Date.parse(token.expires_at))
    ? Date.parse(token.expires_at) <= now
    : false;
}

export class FileTokenStore implements TokenStore {
  readonly dataDir: string;
  readonly filePath: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, "tokens.json");
  }

  async resolve(token: string): Promise<BoardToken | null> {
    const state = await this.readState();
    const match = state.tokens.find((entry) => entry.token === token) ?? null;

    if (!match || match.revoked || isTokenExpired(match)) {
      return null;
    }

    return match;
  }

  async list(): Promise<BoardToken[]> {
    const state = await this.readState();
    return [...state.tokens].sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async create(
    ownerRef: string,
    label: string = "default board",
    expiresAt: string | null = null
  ): Promise<BoardToken> {
    const trimmedOwnerRef = ownerRef.trim();
    if (!trimmedOwnerRef) {
      throw new Error("owner_ref is required.");
    }

    const next: BoardToken = {
      token: generateBoardToken(),
      owner_ref: trimmedOwnerRef,
      created_at: isoNow(),
      expires_at: expiresAt?.trim() || null,
      revoked: false,
      label: label.trim() || "default board"
    };

    const state = await this.readState();
    state.tokens.push(next);
    await this.writeState(state);
    return next;
  }

  async revoke(token: string): Promise<boolean> {
    const state = await this.readState();
    const existing = state.tokens.find((entry) => entry.token === token);

    if (!existing) {
      return false;
    }

    if (!existing.revoked) {
      existing.revoked = true;
      await this.writeState(state);
    }

    return true;
  }

  async rotate(oldToken: string): Promise<BoardToken | null> {
    const state = await this.readState();
    const existing = state.tokens.find((entry) => entry.token === oldToken) ?? null;

    if (!existing) {
      return null;
    }

    existing.revoked = true;

    const next: BoardToken = {
      token: generateBoardToken(),
      owner_ref: existing.owner_ref,
      created_at: isoNow(),
      expires_at: existing.expires_at,
      revoked: false,
      label: existing.label
    };

    state.tokens.push(next);
    await this.writeState(state);
    return next;
  }

  private async readState(): Promise<TokenStoreFile> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<TokenStoreFile> | null;
      const tokens = Array.isArray(parsed?.tokens) ? parsed.tokens.filter(isBoardToken) : [];
      return { tokens };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if ("code" in (error as Record<string, unknown>) && (error as { code?: string }).code !== "ENOENT") {
        throw new Error(`Failed to read board token store: ${message || "unknown error"}`);
      }

      const emptyState: TokenStoreFile = { tokens: [] };
      await this.writeState(emptyState);
      return emptyState;
    }
  }

  private async writeState(state: TokenStoreFile): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}

function isBoardToken(value: unknown): value is BoardToken {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.token === "string" &&
    typeof record.owner_ref === "string" &&
    typeof record.created_at === "string" &&
    (typeof record.expires_at === "string" || record.expires_at === null) &&
    typeof record.revoked === "boolean" &&
    typeof record.label === "string"
  );
}

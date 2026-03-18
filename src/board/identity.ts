import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const BOARD_IDENTITY_FILE = "board-identity.json";
const PUBLIC_FACTS_NODE_SECRET_FILE = path.join("config", "public-facts-node-secret.txt");

export interface BoardIdentity {
  owner_ref: string;
  node_id: string;
  node_secret: string;
  created_at: string;
}

function isoNow(): string {
  return new Date().toISOString();
}

function deriveNodeId(secret: string): string {
  return `anon_${createHash("sha256").update(`${secret}:openclaw-public-facts`).digest("hex").slice(0, 32)}`;
}

function deriveOwnerRef(secret: string): string {
  return `user_${createHash("sha256").update(`${secret}:openclaw-owner`).digest("hex").slice(0, 16)}`;
}

function identityPath(stateRoot: string): string {
  return path.join(stateRoot, BOARD_IDENTITY_FILE);
}

function sharedSecretPath(stateRoot: string): string {
  return path.join(stateRoot, PUBLIC_FACTS_NODE_SECRET_FILE);
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readIdentity(stateRoot: string): Promise<BoardIdentity | null> {
  try {
    const raw = await readFile(identityPath(stateRoot), "utf8");
    const parsed = JSON.parse(raw) as Partial<BoardIdentity> | null;
    if (
      parsed &&
      typeof parsed.owner_ref === "string" &&
      typeof parsed.node_id === "string" &&
      typeof parsed.node_secret === "string" &&
      typeof parsed.created_at === "string"
    ) {
      return {
        owner_ref: parsed.owner_ref,
        node_id: parsed.node_id,
        node_secret: parsed.node_secret,
        created_at: parsed.created_at
      };
    }

    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function getOrCreateSharedNodeSecret(stateRoot: string): Promise<string> {
  const secretFilePath = sharedSecretPath(stateRoot);
  const existing = (await readText(secretFilePath))?.trim();

  if (existing) {
    return existing;
  }

  const next = `secret_${randomBytes(32).toString("hex")}`;
  await mkdir(path.dirname(secretFilePath), { recursive: true });
  await writeFile(secretFilePath, `${next}\n`, "utf8");
  return next;
}

export async function getOrCreateIdentity(stateRoot: string): Promise<BoardIdentity> {
  const existing = await readIdentity(stateRoot);
  if (existing) {
    return existing;
  }

  const nodeSecret = await getOrCreateSharedNodeSecret(stateRoot);
  const identity: BoardIdentity = {
    owner_ref: deriveOwnerRef(nodeSecret),
    node_id: deriveNodeId(nodeSecret),
    node_secret: nodeSecret,
    created_at: isoNow()
  };

  await writeJsonAtomically(identityPath(stateRoot), identity);
  return identity;
}

export function signTimestamp(nodeSecret: string, timestamp: string): string {
  return createHmac("sha256", nodeSecret).update(timestamp).digest("hex");
}

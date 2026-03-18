import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BoardSyncConfig } from "../shared/types.ts";

export const BOARD_CONFIG_FILE = "board-config.json";

export interface PersistedBoardConfig {
  board_token: string;
  board_url: string;
  push_url: string;
  owner_ref: string | null;
  registered_at: string;
}

function boardConfigPath(stateRoot: string): string {
  return path.join(stateRoot, BOARD_CONFIG_FILE);
}

function isPersistedBoardConfig(value: unknown): value is PersistedBoardConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.board_token === "string" &&
    typeof record.board_url === "string" &&
    typeof record.push_url === "string" &&
    (typeof record.owner_ref === "string" || record.owner_ref === null) &&
    typeof record.registered_at === "string"
  );
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function readBoardConfig(stateRoot: string): Promise<PersistedBoardConfig | null> {
  try {
    const raw = await readFile(boardConfigPath(stateRoot), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isPersistedBoardConfig(parsed) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeBoardConfig(
  stateRoot: string,
  config: PersistedBoardConfig
): Promise<void> {
  await writeJsonAtomically(boardConfigPath(stateRoot), config);
}

export function toBoardSyncConfig(
  persisted: PersistedBoardConfig,
  current?: Partial<BoardSyncConfig>
): BoardSyncConfig {
  return {
    enabled: true,
    board_token: persisted.board_token,
    board_push_url: persisted.push_url,
    push_interval_ms: current?.push_interval_ms ?? 15000,
    push_on_mutation: current?.push_on_mutation ?? true,
    timeout_ms: current?.timeout_ms ?? 5000
  };
}

export async function resolveBoardSyncConfigFromStateRoot(
  stateRoot: string,
  current: BoardSyncConfig
): Promise<BoardSyncConfig> {
  if (current.enabled || current.board_token || current.board_push_url) {
    return current;
  }

  const persisted = await readBoardConfig(stateRoot);
  return persisted ? toBoardSyncConfig(persisted, current) : current;
}

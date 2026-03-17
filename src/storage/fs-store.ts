import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

import type {
  AttentionUnit,
  CapabilityFact,
  Checkpoint,
  Event,
  ManagerConfig,
  NormalizedInboundMessage,
  Run,
  Session,
  SkillTrace
} from "../shared/types.ts";
import { InProcessLock } from "./locks.ts";

export class FilesystemStore {
  config: ManagerConfig;
  lock: InProcessLock;

  constructor(config: ManagerConfig) {
    this.config = config;
    this.lock = new InProcessLock();
  }

  paths() {
    const root = this.config.stateRoot;

    return {
      root,
      sessions: path.join(root, "sessions"),
      indexes: path.join(root, "indexes"),
      connectors: path.join(root, "connectors"),
      inbox: path.join(root, "connectors", "inbox"),
      snapshots: path.join(root, "snapshots"),
      exports: path.join(root, "exports")
    };
  }

  sessionDir(sessionId: string): string {
    return path.join(this.paths().sessions, sessionId);
  }

  runDir(sessionId: string, runId: string): string {
    return path.join(this.sessionDir(sessionId), "runs", runId);
  }

  async ensureLayout(): Promise<void> {
    const paths = this.paths();

    await Promise.all([
      mkdir(paths.sessions, { recursive: true }),
      mkdir(paths.indexes, { recursive: true }),
      mkdir(paths.connectors, { recursive: true }),
      mkdir(paths.inbox, { recursive: true }),
      mkdir(paths.snapshots, { recursive: true }),
      mkdir(paths.exports, { recursive: true })
    ]);
  }

  async ensureSessionLayout(sessionId: string): Promise<void> {
    const base = this.sessionDir(sessionId);

    await Promise.all([
      mkdir(path.join(base, "share"), { recursive: true }),
      mkdir(path.join(base, "artifacts"), { recursive: true }),
      mkdir(path.join(base, "runs"), { recursive: true })
    ]);
  }

  async ensureRunLayout(sessionId: string, runId: string): Promise<void> {
    await this.ensureSessionLayout(sessionId);
    await mkdir(this.runDir(sessionId, runId), { recursive: true });
  }

  async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const contents = await readFile(filePath, "utf8");
      return JSON.parse(contents) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async writeJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  async readText(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async writeText(filePath: string, value: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, value, "utf8");
  }

  async appendJsonl(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
  }

  async listSessionIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.paths().sessions, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async listSessions(): Promise<Session[]> {
    const sessionIds = await this.listSessionIds();
    const sessions = await Promise.all(sessionIds.map((sessionId) => this.readSession(sessionId)));
    return sessions.filter((session): session is Session => session !== null);
  }

  async readSession(sessionId: string): Promise<Session | null> {
    return this.readJson<Session>(path.join(this.sessionDir(sessionId), "session.json"));
  }

  async writeSession(session: Session): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.ensureSessionLayout(session.session_id);
      await this.writeJson(path.join(this.sessionDir(session.session_id), "session.json"), session);
    });
  }

  async readSummary(sessionId: string): Promise<string | null> {
    return this.readText(path.join(this.sessionDir(sessionId), "summary.md"));
  }

  async writeSummary(sessionId: string, summary: string): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.ensureSessionLayout(sessionId);
      await this.writeText(path.join(this.sessionDir(sessionId), "summary.md"), summary);
    });
  }

  async writeAttention(sessionId: string, attentionUnits: AttentionUnit[]): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.ensureSessionLayout(sessionId);
      await this.writeJson(path.join(this.sessionDir(sessionId), "attention.json"), attentionUnits);
    });
  }

  async readRun(sessionId: string, runId: string): Promise<Run | null> {
    return this.readJson<Run>(path.join(this.runDir(sessionId, runId), "run.json"));
  }

  async listRunIds(sessionId: string): Promise<string[]> {
    try {
      const entries = await readdir(path.join(this.sessionDir(sessionId), "runs"), {
        withFileTypes: true
      });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async listRuns(sessionId: string): Promise<Run[]> {
    const runIds = await this.listRunIds(sessionId);
    const runs = await Promise.all(runIds.map((runId) => this.readRun(sessionId, runId)));
    return runs
      .filter((run): run is Run => run !== null)
      .sort((left, right) => right.started_at.localeCompare(left.started_at));
  }

  async writeRun(sessionId: string, run: Run): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.ensureRunLayout(sessionId, run.run_id);
      await this.writeJson(path.join(this.runDir(sessionId, run.run_id), "run.json"), run);
    });
  }

  async writeCheckpoint(sessionId: string, runId: string, checkpoint: Checkpoint): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.ensureRunLayout(sessionId, runId);
      await this.writeJson(path.join(this.runDir(sessionId, runId), "checkpoint.json"), checkpoint);
    });
  }

  async readCheckpoint(sessionId: string, runId: string): Promise<Checkpoint | null> {
    return this.readJson<Checkpoint>(path.join(this.runDir(sessionId, runId), "checkpoint.json"));
  }

  async appendEvent(sessionId: string, runId: string | null, event: Event): Promise<void> {
    await this.lock.runExclusive(async () => {
      if (runId) {
        await this.ensureRunLayout(sessionId, runId);
        await this.appendJsonl(path.join(this.runDir(sessionId, runId), "events.jsonl"), event);
        return;
      }

      await this.ensureSessionLayout(sessionId);
      await this.appendJsonl(path.join(this.sessionDir(sessionId), "events.jsonl"), event);
    });
  }

  async appendSkillTrace(sessionId: string, runId: string, trace: SkillTrace): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.ensureRunLayout(sessionId, runId);
      await this.appendJsonl(path.join(this.runDir(sessionId, runId), "skill_traces.jsonl"), trace);
    });
  }

  async appendSpoolLine(sessionId: string, runId: string, payload: unknown): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.ensureRunLayout(sessionId, runId);
      await this.appendJsonl(path.join(this.runDir(sessionId, runId), "spool.jsonl"), payload);
    });
  }

  async writeSessionIndexes(sessionsIndex: unknown, activeSessionsIndex: unknown): Promise<void> {
    await this.lock.runExclusive(async () => {
      await Promise.all([
        this.writeJson(path.join(this.paths().indexes, "sessions.json"), sessionsIndex),
        this.writeJson(path.join(this.paths().indexes, "active_sessions.json"), activeSessionsIndex)
      ]);
    });
  }

  async writeAttentionQueue(attentionQueue: AttentionUnit[]): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.writeJson(path.join(this.paths().indexes, "attention_queue.json"), attentionQueue);
    });
  }

  async appendCapabilityFacts(facts: CapabilityFact[]): Promise<void> {
    await this.lock.runExclusive(async () => {
      for (const fact of facts) {
        await this.appendJsonl(path.join(this.paths().indexes, "capability_facts.jsonl"), fact);
      }
    });
  }

  async readAttentionQueue(): Promise<AttentionUnit[] | null> {
    return this.readJson<AttentionUnit[]>(path.join(this.paths().indexes, "attention_queue.json"));
  }

  async writeInboundMessage(message: NormalizedInboundMessage): Promise<void> {
    await this.lock.runExclusive(async () => {
      await this.writeJson(path.join(this.paths().inbox, `${message.request_id}.json`), message);
    });
  }

  async readInboundMessage(requestId: string): Promise<NormalizedInboundMessage | null> {
    return this.readJson<NormalizedInboundMessage>(
      path.join(this.paths().inbox, `${requestId}.json`)
    );
  }

  async writeSnapshot(snapshotId: string, files: Record<string, string>): Promise<string> {
    const targetDir = path.join(this.paths().snapshots, snapshotId);

    await this.lock.runExclusive(async () => {
      await mkdir(targetDir, { recursive: true });

      for (const [relativePath, contents] of Object.entries(files)) {
        await this.writeText(path.join(targetDir, relativePath), contents);
      }
    });

    return targetDir;
  }
}

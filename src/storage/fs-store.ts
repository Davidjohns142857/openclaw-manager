import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { createId } from "../shared/ids.ts";
import { isoNow } from "../shared/time.ts";
import type {
  AttentionUnit,
  CapabilityFact,
  Checkpoint,
  Event,
  ManagerConfig,
  NormalizedInboundMessage,
  RecoveryHead,
  Run,
  Session,
  SkillTrace
} from "../shared/types.ts";
import { InProcessLock } from "./locks.ts";
import { SchemaRegistry, type SchemaKind } from "./schema-registry.ts";

export class FilesystemStore {
  config: ManagerConfig;
  lock: InProcessLock;
  schemaRegistry: SchemaRegistry;

  constructor(config: ManagerConfig) {
    this.config = config;
    this.lock = new InProcessLock();
    this.schemaRegistry = new SchemaRegistry(config.schemasDir);
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

  inboundRequestDir(requestId: string): string {
    return path.join(this.paths().inbox, requestId);
  }

  recoveryHeadPath(sessionId: string, runId: string): string {
    return path.join(this.runDir(sessionId, runId), "recovery-head.json");
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

  async readValidatedJson<T>(kind: SchemaKind, filePath: string): Promise<T | null> {
    const value = await this.readJson<T>(filePath);

    if (value === null) {
      return null;
    }

    await this.schemaRegistry.validateOrThrow(kind, value);
    return value;
  }

  async writeJson(filePath: string, value: unknown): Promise<void> {
    await this.writeFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
    await this.writeFileAtomically(filePath, value);
  }

  async writeFileAtomically(filePath: string, value: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${createId("tmp")}.partial`
    );

    try {
      await writeFile(tempPath, value, "utf8");
      await rename(tempPath, filePath);
    } catch (error) {
      await this.safeUnlink(tempPath);
      throw error;
    }
  }

  async appendJsonl(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
  }

  async safeUnlink(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }

      throw error;
    }
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
    return this.readValidatedJson<Session>("session", path.join(this.sessionDir(sessionId), "session.json"));
  }

  async writeSession(session: Session): Promise<void> {
    await this.schemaRegistry.validateOrThrow("session", session);

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

  async writeCommittedRecoverySummary(sessionId: string, runId: string, summary: string): Promise<void> {
    const head = await this.readJson<RecoveryHead>(this.recoveryHeadPath(sessionId, runId));

    if (!head) {
      throw new Error(`Recovery head missing for ${sessionId}/${runId}`);
    }

    await this.writeSummary(
      sessionId,
      `<!-- recovery_transaction:${head.transaction_id} -->\n${summary}`
    );
  }

  async readRecoverySummary(sessionId: string, runId: string): Promise<string | null> {
    const head = await this.readJson<RecoveryHead>(this.recoveryHeadPath(sessionId, runId));

    if (!head) {
      return null;
    }

    const summary = await this.readSummary(sessionId);

    if (!summary) {
      return null;
    }

    const [marker, ...lines] = summary.split("\n");
    const match = marker.match(/^<!-- recovery_transaction:(.+) -->$/);

    if (!match || match[1] !== head.transaction_id) {
      return null;
    }

    return lines.join("\n");
  }

  async writeAttention(sessionId: string, attentionUnits: AttentionUnit[]): Promise<void> {
    for (const attentionUnit of attentionUnits) {
      await this.schemaRegistry.validateOrThrow("attention-unit", attentionUnit);
    }

    await this.lock.runExclusive(async () => {
      await this.ensureSessionLayout(sessionId);
      await this.writeJson(path.join(this.sessionDir(sessionId), "attention.json"), attentionUnits);
    });
  }

  async readRun(sessionId: string, runId: string): Promise<Run | null> {
    return this.readValidatedJson<Run>("run", path.join(this.runDir(sessionId, runId), "run.json"));
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
    await this.schemaRegistry.validateOrThrow("run", run);

    await this.lock.runExclusive(async () => {
      await this.ensureRunLayout(sessionId, run.run_id);
      await this.writeJson(path.join(this.runDir(sessionId, run.run_id), "run.json"), run);
    });
  }

  async writeRecoveryArtifacts(
    sessionId: string,
    runId: string,
    checkpoint: Checkpoint,
    summary: string
  ): Promise<Checkpoint> {
    await this.schemaRegistry.validateOrThrow("checkpoint", checkpoint);

    const transactionId = createId("tx");
    const checkpointWithTransaction: Checkpoint = {
      ...checkpoint,
      metadata: {
        ...checkpoint.metadata,
        transaction_id: transactionId
      }
    };

    await this.lock.runExclusive(async () => {
      await this.ensureRunLayout(sessionId, runId);

      const runDir = this.runDir(sessionId, runId);
      const sessionDir = this.sessionDir(sessionId);
      const checkpointPath = path.join(runDir, "checkpoint.json");
      const summaryPath = path.join(sessionDir, "summary.md");
      const headPath = this.recoveryHeadPath(sessionId, runId);
      const checkpointTempPath = path.join(runDir, `.checkpoint.${transactionId}.json.tmp`);
      const summaryTempPath = path.join(sessionDir, `.summary.${transactionId}.md.tmp`);
      const headTempPath = path.join(runDir, `.recovery-head.${transactionId}.json.tmp`);
      const summaryWithMarker = `<!-- recovery_transaction:${transactionId} -->\n${summary}`;
      const head: RecoveryHead = {
        session_id: sessionId,
        run_id: runId,
        transaction_id: transactionId,
        committed_at: isoNow()
      };

      try {
        await this.writeJson(checkpointTempPath, checkpointWithTransaction);
        await this.writeText(summaryTempPath, summaryWithMarker);
        await rename(summaryTempPath, summaryPath);
        await rename(checkpointTempPath, checkpointPath);
        await this.writeJson(headTempPath, head);
        await rename(headTempPath, headPath);
      } catch (error) {
        await Promise.all([
          this.safeUnlink(checkpointTempPath),
          this.safeUnlink(summaryTempPath),
          this.safeUnlink(headTempPath)
        ]);
        throw error;
      }
    });

    return checkpointWithTransaction;
  }

  async readCheckpoint(sessionId: string, runId: string): Promise<Checkpoint | null> {
    const head = await this.readJson<RecoveryHead>(this.recoveryHeadPath(sessionId, runId));

    if (!head) {
      return null;
    }

    const checkpoint = await this.readValidatedJson<Checkpoint>(
      "checkpoint",
      path.join(this.runDir(sessionId, runId), "checkpoint.json")
    );

    if (!checkpoint) {
      return null;
    }

    if (checkpoint.metadata.transaction_id !== head.transaction_id) {
      return null;
    }

    return checkpoint;
  }

  async appendEvent(sessionId: string, runId: string | null, event: Event): Promise<void> {
    await this.schemaRegistry.validateOrThrow("event", event);

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
    await this.schemaRegistry.validateOrThrow("skill-trace", trace);

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
    for (const attentionUnit of attentionQueue) {
      await this.schemaRegistry.validateOrThrow("attention-unit", attentionUnit);
    }

    await this.lock.runExclusive(async () => {
      await this.writeJson(path.join(this.paths().indexes, "attention_queue.json"), attentionQueue);
    });
  }

  async appendCapabilityFacts(facts: CapabilityFact[]): Promise<void> {
    for (const fact of facts) {
      await this.schemaRegistry.validateOrThrow("capability-fact", fact);
    }

    await this.lock.runExclusive(async () => {
      for (const fact of facts) {
        await this.appendJsonl(path.join(this.paths().indexes, "capability_facts.jsonl"), fact);
      }
    });
  }

  async readAttentionQueue(): Promise<AttentionUnit[] | null> {
    return this.readJson<AttentionUnit[]>(path.join(this.paths().indexes, "attention_queue.json"));
  }

  async tryClaimInboundMessage(message: NormalizedInboundMessage): Promise<{
    status: "claimed" | "duplicate";
    existing: NormalizedInboundMessage | null;
  }> {
    await this.schemaRegistry.validateOrThrow("inbound-message", message);
    await mkdir(this.paths().inbox, { recursive: true });
    const claimDir = this.inboundRequestDir(message.request_id);

    try {
      await mkdir(claimDir);
      const fileHandle = await open(path.join(claimDir, "message.json"), "wx");

      try {
        await fileHandle.writeFile(`${JSON.stringify(message, null, 2)}\n`, "utf8");
      } finally {
        await fileHandle.close();
      }

      return {
        status: "claimed",
        existing: null
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      for (let attempt = 0; attempt < 10; attempt += 1) {
        let existing: NormalizedInboundMessage | null = null;

        try {
          existing = await this.readInboundMessage(message.request_id);
        } catch {
          existing = null;
        }

        if (existing) {
          return {
            status: "duplicate",
            existing
          };
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      throw new Error(`Inbound request ${message.request_id} is claimed but payload is unreadable.`);
    }
  }

  async readInboundMessage(requestId: string): Promise<NormalizedInboundMessage | null> {
    return this.readValidatedJson<NormalizedInboundMessage>(
      "inbound-message",
      path.join(this.inboundRequestDir(requestId), "message.json")
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

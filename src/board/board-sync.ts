import { serializeSession, serializeSessionDetail } from "../api/serializers.ts";
import type { ControlPlane } from "../control-plane/control-plane.ts";
import type { BoardSyncConfig } from "../shared/types.ts";

export interface BoardSnapshot {
  snapshot_at: string;
  sessions: Array<Record<string, unknown>>;
  focus: Array<Record<string, unknown>>;
  session_details: Record<string, Record<string, unknown>>;
}

export class BoardSyncService {
  readonly config: BoardSyncConfig;
  readonly controlPlane: ControlPlane;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  pendingPush: boolean;

  constructor(config: BoardSyncConfig, controlPlane: ControlPlane) {
    this.config = config;
    this.controlPlane = controlPlane;
    this.timer = null;
    this.inFlight = null;
    this.pendingPush = false;
  }

  start(): void {
    if (!this.config.enabled || !this.config.board_push_url || !this.config.board_token) {
      return;
    }

    void this.pushNow();
    this.timer = setInterval(() => {
      void this.pushNow();
    }, this.config.push_interval_ms);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pushNow(): Promise<void> {
    if (!this.config.enabled || !this.config.board_push_url || !this.config.board_token) {
      return;
    }

    if (this.inFlight) {
      this.pendingPush = true;
      await this.inFlight;
      return;
    }

    this.inFlight = this.push();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
      if (this.pendingPush) {
        this.pendingPush = false;
        await this.pushNow();
      }
    }
  }

  private async push(): Promise<void> {
    try {
      const snapshot = await this.buildSnapshot();
      const response = await fetch(this.config.board_push_url!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-board-token": this.config.board_token!
        },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(this.config.timeout_ms)
      });

      if (!response.ok) {
        console.warn(`[board-sync] push failed: ${response.status}`);
      }
    } catch (error) {
      console.warn(
        `[board-sync] push error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async buildSnapshot(): Promise<BoardSnapshot> {
    const storedSessions = await this.controlPlane.listTasks();
    const sessions = await Promise.all(
      storedSessions.map(async (session) => {
        const latestRun = session.active_run_id
          ? await this.controlPlane.store.readRun(session.session_id, session.active_run_id)
          : await this.controlPlane.getLatestRun(session.session_id);
        return serializeSession(session, latestRun);
      })
    );
    const detailEntries = await Promise.all(
      storedSessions.map(async (session) => {
        try {
          const detail = await this.controlPlane.getSessionDetail(session.session_id);
          return [session.session_id, serializeSessionDetail(detail)] as const;
        } catch {
          return null;
        }
      })
    );

    const sessionDetails = Object.fromEntries(
      detailEntries
        .filter((entry): entry is NonNullable<(typeof detailEntries)[number]> => entry !== null)
        .map(([sessionId, detail]) => [sessionId, detail])
    );

    const focus = (await this.controlPlane.focus()).map((item) => ({ ...item }));

    return {
      snapshot_at: new Date().toISOString(),
      sessions,
      focus,
      session_details: sessionDetails
    };
  }
}

import path from "node:path";

import type { ShareSnapshotResult } from "../shared/contracts.ts";
import type { ManagerConfig, Run, Session } from "../shared/types.ts";
import { createId } from "../shared/ids.ts";
import { renderSnapshotHtml } from "../exporters/snapshot-html.ts";
import { FilesystemStore } from "../storage/fs-store.ts";

export class ShareService {
  config: ManagerConfig;
  store: FilesystemStore;

  constructor(config: ManagerConfig, store: FilesystemStore) {
    this.config = config;
    this.store = store;
  }

  async createSnapshot(
    session: Session,
    summary: string,
    run: Run | null
  ): Promise<ShareSnapshotResult> {
    const snapshotId = createId("snap");
    const snapshotPath = path.join(this.config.stateRoot, "snapshots", snapshotId);
    const exportedAt = new Date().toISOString();
    const manifest = {
      snapshot_id: snapshotId,
      session_id: session.session_id,
      latest_run_id: run?.run_id ?? null,
      status: session.status,
      exported_at: exportedAt
    };
    const indexHtml = await renderSnapshotHtml(this.config, session, summary, run);

    await this.store.writeSnapshot(snapshotId, {
      "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
      "summary.md": summary,
      "index.html": indexHtml,
      "artifacts/README.txt": "Phase 1 placeholder for exported artifacts.\n",
      "traces/README.txt": "Phase 1 placeholder for run evidence exports.\n"
    });

    return {
      session_id: session.session_id,
      snapshot_id: snapshotId,
      snapshot_path: snapshotPath,
      manifest_path: path.join(snapshotPath, "manifest.json"),
      index_path: path.join(snapshotPath, "index.html")
    };
  }
}


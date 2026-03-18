import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";

import { BoardSnapshotStore } from "../board/snapshot-store.ts";
import { resolveConfig } from "../src/config.ts";
import { buildBoardViewerUrlFromPushUrl } from "../src/shared/ui.ts";

test("board viewer URL derives from board push URL instead of 18891 ui", () => {
  const viewerUrl = buildBoardViewerUrlFromPushUrl(
    "http://142.171.114.18:18991/board-sync/bt_demo",
    "bt_demo"
  );

  assert.equal(viewerUrl, "http://142.171.114.18:18991/board/bt_demo/");
});

test("manual-adopt config no longer auto-derives published ui from public ingest", () => {
  const config = resolveConfig({
    OPENCLAW_MANAGER_HOST_INTEGRATION_MODE: "manual_adopt",
    OPENCLAW_MANAGER_PUBLIC_FACTS_AUTO_SUBMIT_ENABLED: "1",
    OPENCLAW_MANAGER_PUBLIC_FACTS_ENDPOINT: "http://142.171.114.18:56557/v1/ingest"
  });

  assert.equal(config.ui.public_base_url, null);
  assert.equal(config.ui.publish_port, null);
});

test("board snapshot store sanitizes filesystem refs but keeps slash commands intact", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-board-"));
  const store = new BoardSnapshotStore(tempDir);

  try {
    await store.writeLatest("bt_demo_token", "user_primary", {
      snapshot_at: "2026-03-18T10:00:00.000Z",
      sessions: [
        {
          session_id: "sess_demo",
          objective: "/adopt current task",
          state_root: "/var/lib/openclaw-manager",
          latest_checkpoint_ref: "/var/lib/openclaw-manager/checkpoints/checkpoint.json"
        }
      ],
      focus: [],
      session_details: {
        sess_demo: {
          session: {
            session_id: "sess_demo",
            objective: "/tasks",
            latest_summary_ref: "/var/lib/openclaw-manager/summaries/summary.md"
          },
          checkpoint: {
            artifact_refs: ["/var/lib/openclaw-manager/artifacts/report.md"]
          }
        }
      },
      session_timelines: {
        sess_demo: {
          session: {
            session_id: "sess_demo"
          },
          runs: [
            {
              run_id: "run_demo",
              evidence: {
                events_ref: "/var/lib/openclaw-manager/events/events.jsonl"
              }
            }
          ]
        }
      }
    });

    const snapshot = await store.readLatest("bt_demo_token");
    const session = snapshot?.sessions[0] as Record<string, unknown>;
    const detail = snapshot?.session_details.sess_demo as Record<string, unknown>;
    const detailSession = detail.session as Record<string, unknown>;
    const checkpoint = detail.checkpoint as Record<string, unknown>;
    const timeline = snapshot?.session_timelines.sess_demo as Record<string, unknown>;
    const run = (timeline.runs as Array<Record<string, unknown>>)[0]!;
    const evidence = run.evidence as Record<string, unknown>;

    assert.equal(session.objective, "/adopt current task");
    assert.equal(session.state_root, null);
    assert.equal(session.latest_checkpoint_ref, "checkpoint.json");
    assert.equal(detailSession.objective, "/tasks");
    assert.equal(detailSession.latest_summary_ref, "summary.md");
    assert.deepEqual(checkpoint.artifact_refs, ["report.md"]);
    assert.equal(evidence.events_ref, "events.jsonl");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

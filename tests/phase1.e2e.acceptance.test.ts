import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { test } from "node:test";

import { createTempManager, pathExists, readJson, sessionPaths } from "./helpers.ts";

test("happy path adopt -> durable artifacts -> resume -> close", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Phase 1 happy path",
      objective: "Validate session durability."
    });
    const paths = sessionPaths(
      manager.tempRoot,
      adopted.session.session_id,
      adopted.run.run_id
    );

    assert.equal(adopted.session.active_run_id, adopted.run.run_id);
    assert.equal(await pathExists(paths.sessionJson), true);
    assert.equal(await pathExists(paths.runJson), true);
    assert.equal(await pathExists(paths.checkpoint), true);
    assert.equal(await pathExists(paths.summary), true);
    assert.equal(await pathExists(paths.events), true);

    const sessionOnDisk = await readJson<{ session_id: string; active_run_id: string }>(paths.sessionJson);
    assert.equal(sessionOnDisk.session_id, adopted.session.session_id);
    assert.equal(sessionOnDisk.active_run_id, adopted.run.run_id);

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.ok(resumed.checkpoint);
    assert.ok(resumed.summary);

    const closed = await manager.controlPlane.closeSession(adopted.session.session_id, {
      outcome_summary: "Phase 1 close path validated.",
      resolution: "completed"
    });
    assert.equal(closed.status, "completed");
    assert.equal(closed.active_run_id, null);
  } finally {
    await manager.cleanup();
  }
});

test("resume still works without historical event replay when checkpoint and summary exist", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Recovery without event replay",
      objective: "Events should not be required for basic recovery."
    });
    const paths = sessionPaths(
      manager.tempRoot,
      adopted.session.session_id,
      adopted.run.run_id
    );

    await rm(paths.events);

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);
    assert.ok(resumed.checkpoint);
    assert.ok(resumed.summary);
  } finally {
    await manager.cleanup();
  }
});

test("checkpoint should be authoritative over mutable session.json during recovery", async () => {
  const manager = await createTempManager();

  try {
    const adopted = await manager.controlPlane.adoptSession({
      title: "Checkpoint authority",
      objective: "Checkpoint should drive recovery state."
    });
    const paths = sessionPaths(
      manager.tempRoot,
      adopted.session.session_id,
      adopted.run.run_id
    );

    const checkpoint = await readJson<{ phase: string }>(paths.checkpoint);
    checkpoint.phase = "phase_from_checkpoint";
    await writeFile(paths.checkpoint, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");

    const session = await readJson<any>(paths.sessionJson);
    session.state.phase = "phase_from_session";
    await writeFile(paths.sessionJson, `${JSON.stringify(session, null, 2)}\n`, "utf8");

    const resumed = await manager.controlPlane.resumeSession(adopted.session.session_id);

    assert.equal(
      resumed.session.state.phase,
      "phase_from_checkpoint",
      "Recovery should prefer checkpoint.json over mutable session.json."
    );
  } finally {
    await manager.cleanup();
  }
});


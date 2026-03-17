import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { ManagerServer } from "../src/api/server.ts";
import { createTempManager, dispatchRoute } from "./helpers.ts";

const repoRoot = "/Users/yangshangqing/metaclaw";

test("server exposes reserved decision and blocker mutation contracts through GET /contracts", async () => {
  const manager = await createTempManager();

  try {
    const server = new ManagerServer(manager.controlPlane, manager.config);
    const response = await dispatchRoute(server, "GET", "/contracts");

    assert.equal(response.statusCode, 200);
    const payload = response.body as {
      version: string;
      contracts: Array<{
        contract_id: string;
        contract_state: string;
        owner: string;
        method: string;
        path: string;
        request_fields: Array<{ name: string; required: boolean }>;
        response_envelope: string;
        emits_events: string[];
        invariants: string[];
        docs: string[];
      }>;
    };

    assert.equal(payload.version, "phase-1.5-contracts");
    assert.equal(payload.contracts.length, 4);

    const contractIds = new Set(payload.contracts.map((contract) => contract.contract_id));
    assert.deepEqual(contractIds, new Set([
      "session_decision_request_v1",
      "session_decision_resolve_v1",
      "session_blocker_detect_v1",
      "session_blocker_clear_v1"
    ]));

    for (const contract of payload.contracts) {
      assert.equal(contract.contract_state, "reserved");
      assert.equal(contract.owner, "ysq");
      assert.equal(contract.method, "POST");
      assert.equal(contract.response_envelope, "session_detail");
      assert.ok(contract.request_fields.length > 0);
      assert.ok(contract.invariants.length > 0);
      assert.ok(contract.docs.includes("docs/decision-blocker-api-contract.md"));
    }

    const decisionRequest = payload.contracts.find(
      (contract) => contract.contract_id === "session_decision_request_v1"
    );
    assert.ok(decisionRequest);
    assert.equal(decisionRequest.path, "/sessions/:session_id/decisions");
    assert.equal(decisionRequest.emits_events[0], "human_decision_requested");
    assert.ok(
      decisionRequest.request_fields.some((field) => field.name === "summary" && field.required)
    );

    const blockerClear = payload.contracts.find(
      (contract) => contract.contract_id === "session_blocker_clear_v1"
    );
    assert.ok(blockerClear);
    assert.equal(blockerClear.path, "/sessions/:session_id/blockers/:blocker_id/clear");
    assert.equal(blockerClear.emits_events[0], "blocker_cleared");
    assert.ok(
      blockerClear.request_fields.some(
        (field) => field.name === "resolution_summary" && field.required
      )
    );
  } finally {
    await manager.cleanup();
  }
});

test("decision/blocker API docs and machine-readable registry stay aligned", async () => {
  const [apiDoc, boundaryDoc] = await Promise.all([
    readFile(path.join(repoRoot, "docs/decision-blocker-api-contract.md"), "utf8"),
    readFile(path.join(repoRoot, "docs/http-protocol-boundary.md"), "utf8")
  ]);

  assert.match(apiDoc, /GET \/contracts/);
  assert.match(apiDoc, /POST \/sessions\/:session_id\/decisions/);
  assert.match(apiDoc, /POST \/sessions\/:session_id\/decisions\/:decision_id\/resolve/);
  assert.match(apiDoc, /POST \/sessions\/:session_id\/blockers/);
  assert.match(apiDoc, /POST \/sessions\/:session_id\/blockers\/:blocker_id\/clear/);
  assert.match(boundaryDoc, /GET \/contracts/);
});

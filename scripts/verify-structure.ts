import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredPaths = [
  "package.json",
  "README.md",
  "skill.yaml",
  "docs/mvp-requirements.md",
  "docs/connector-protocol.md",
  "docs/run-lifecycle.md",
  "docs/run-guarantees.md",
  "docs/run-timeline-contract.md",
  "docs/session-status-derivation.md",
  "docs/browser-connector.md",
  "docs/github-connector.md",
  "docs/openclaw-host-integration.md",
  "docs/host-message-admission.md",
  "docs/interaction-contract.md",
  "docs/decision-blocker-contract.md",
  "docs/decision-blocker-api-contract.md",
  "docs/reserved-contract-implementation-strategy.md",
  "schemas/session.schema.json",
  "schemas/run.schema.json",
  "schemas/event.schema.json",
  "schemas/connector-binding.schema.json",
  "schemas/checkpoint.schema.json",
  "templates/session-summary.md",
  "src/main.ts",
  "src/api/server.ts",
  "src/api/contracts.ts",
  "src/connectors/browser.ts",
  "src/connectors/github.ts",
  "src/control-plane/binding-service.ts",
  "src/control-plane/control-plane.ts",
  "src/host/context.ts",
  "src/host/admission-policy.ts",
  "src/host/suggest-or-adopt.ts",
  "src/timeline/timeline-service.ts",
  "src/control-plane/reserved-contract-service.ts",
  "src/storage/fs-store.ts",
  "src/storage/schema-registry.ts",
  "src/skill/sidecar-client.ts",
  "src/shared/session-status.ts",
  "src/shared/reserved-contracts.ts",
  "skills/openclaw-manager/SKILL.md",
  "skills/openclaw-manager/agents/openai.yaml"
];

for (const relativePath of requiredPaths) {
  await access(path.join(repoRoot, relativePath));
}

console.log(`Structure check passed for ${requiredPaths.length} required paths.`);

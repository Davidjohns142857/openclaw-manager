import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredPaths = [
  "package.json",
  "README.md",
  "skill.yaml",
  "docs/mvp-requirements.md",
  "docs/openclaw-host-integration.md",
  "docs/interaction-contract.md",
  "schemas/session.schema.json",
  "schemas/run.schema.json",
  "schemas/event.schema.json",
  "schemas/checkpoint.schema.json",
  "templates/session-summary.md",
  "src/main.ts",
  "src/api/server.ts",
  "src/control-plane/control-plane.ts",
  "src/storage/fs-store.ts",
  "src/storage/schema-registry.ts",
  "src/skill/sidecar-client.ts",
  "skills/openclaw-manager/SKILL.md",
  "skills/openclaw-manager/agents/openai.yaml"
];

for (const relativePath of requiredPaths) {
  await access(path.join(repoRoot, relativePath));
}

console.log(`Structure check passed for ${requiredPaths.length} required paths.`);

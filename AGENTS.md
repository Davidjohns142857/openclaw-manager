# Repository Guidelines

## Product Frame

- This repository implements the Phase 1 MVP of OpenClaw Manager.
- Treat `session`, `run`, and `event` as the stable ground truth.
- Keep the system filesystem-first until there is a concrete query or scale requirement that justifies SQLite.

## Runtime Rules

- Default runtime state lives under `.openclaw-manager-state/` during development.
- Production-oriented state paths should still map to `~/.openclaw/skills/manager`.
- Append facts to `events.jsonl`, `skill_traces.jsonl`, and `capability_facts.jsonl`; do not overwrite history files.

## Implementation Rules

- Prefer plain Node 24 built-ins and TypeScript that runs through native type stripping.
- Avoid framework-heavy code in Phase 1.
- Keep connector implementations behind normalized inbound-message contracts.
- When adding new commands, update both [`skills/openclaw-manager/SKILL.md`](/Users/yangshangqing/metaclaw/skills/openclaw-manager/SKILL.md) and [`src/skill/commands.ts`](/Users/yangshangqing/metaclaw/src/skill/commands.ts).
- When updating install, onboarding, or user-facing product guidance, keep [`FIRST_RUN.md`](/Users/yangshangqing/metaclaw/FIRST_RUN.md) aligned and treat it as the canonical end-user onboarding document.

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ManagerConfig, Run, Session } from "../shared/types.ts";
import { renderTemplate } from "../shared/template.ts";

export async function renderSnapshotHtml(
  config: ManagerConfig,
  session: Session,
  summary: string,
  run: Run | null
): Promise<string> {
  const template = await readFile(path.join(config.templatesDir, "snapshot.html"), "utf8");

  return renderTemplate(template, {
    title: session.title,
    objective: session.objective,
    status: session.status,
    session_id: session.session_id,
    exported_at: new Date().toISOString(),
    summary,
    latest_run: run?.run_id ?? "-"
  });
}


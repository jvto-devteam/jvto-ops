#!/usr/bin/env node
// SessionStart hook: a short brief of open work, read from
// <ekosistem>/state/goals.json. That file is project state, not plugin
// code — it doesn't ship with jvto-ops, so a fresh checkout (or a session
// with no sibling jvto-ekosistem yet) has nothing to read. Silence in that
// case is deliberate: a hook that prints noise on every fresh checkout
// trains people to ignore it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ekosystemRoot, rootOverride, runCli } from "./lib/repos.mjs";

export function formatBrief(goals) {
  const lines = [];
  const baselineDate = goals?.baseline?.measuredAt;
  if (baselineDate) {
    lines.push(`jvto-ops: baseline measured ${baselineDate}`);
  }

  const open = Array.isArray(goals?.backlog)
    ? goals.backlog.filter((item) => item?.status === "open")
    : [];
  if (open.length > 0) {
    lines.push(`jvto-ops: ${open.length} open backlog item(s):`);
    for (const item of open) {
      lines.push(`  - [${item.id ?? "?"}] ${item.title ?? "(untitled)"}`);
    }
  }

  const decisionCount = Array.isArray(goals?.decisions) ? goals.decisions.length : 0;
  if (decisionCount > 0) {
    lines.push(`jvto-ops: ${decisionCount} recorded policy decision(s) in state/goals.json`);
  }

  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const root = ekosystemRoot(rootOverride(argv));
  const goalsPath = path.join(root, "state", "goals.json");

  if (!existsSync(goalsPath)) {
    process.exit(0);
  }

  let goals;
  try {
    goals = JSON.parse(readFileSync(goalsPath, "utf8"));
  } catch {
    process.exit(0);
  }

  const brief = formatBrief(goals);
  if (brief) console.log(brief);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // session-brief never calls requireRepo() (a missing goals.json already
  // degrades to silent exit 0 above), but it's wrapped the same way as the
  // other four scripts anyway — one consistent CLI entry-point convention,
  // and a safety net against any future change here that starts throwing.
  runCli("session-brief", main);
}

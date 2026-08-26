#!/usr/bin/env node
// Dispatches Claude Code hook events to at most one checker.
//
// Policy (deliberate, not incidental):
//   - Everything warns; only check-graph-integrity may block. That checker
//     went through four review rounds to get its false-positive rate to
//     zero. The other three haven't earned blocking status, so a post-edit
//     dispatch always exits 0 regardless of what the checker found — the
//     findings still print, they just never fail the tool call.
//   - The live auditor (audit-answer-structure.py) is never reachable from
//     here. It fetches 291 pages; it's a manual or weekly tool, not
//     something that runs on every edit or push.
//   - The common case — editing a README, a plan doc, anything outside the
//     two repos' watched paths — selects no checker and exits immediately.
//     Exactly one checker runs per invocation, or none.
//
// selectChecker() is pure (no I/O, no process exit) so it's testable without
// spawning a child process or wiring up real stdin.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

function toPosix(p) {
  return typeof p === "string" ? p.split(path.sep).join("/") : "";
}

/**
 * selectChecker(mode, payload) -> checker name | null
 *
 * mode: "post-edit" | "pre-push"
 * payload: the parsed hook JSON (the `tool_input` shape Claude Code sends
 * for PostToolUse/PreToolUse hooks).
 */
export function selectChecker(mode, payload) {
  if (mode === "post-edit") {
    const filePath = toPosix(payload?.tool_input?.file_path);
    if (!filePath) return null;
    const basename = filePath.split("/").pop() ?? "";

    if (
      filePath.includes("1-knowledge-and-evidence-core") &&
      (filePath.endsWith(".source.json") || filePath.endsWith(".content.json"))
    ) {
      return "check-answer-first";
    }

    if (filePath.includes("jvto-web/src") && filePath.endsWith(".tsx")) {
      return "check-ssot-drift";
    }

    if (basename === "package.json" || filePath.includes(".github/workflows")) {
      return "check-script-wiring";
    }

    return null;
  }

  if (mode === "pre-push") {
    const command = payload?.tool_input?.command;
    if (typeof command === "string" && /\bgit\s+push\b/.test(command)) {
      return "check-graph-integrity";
    }
    return null;
  }

  return null;
}

function checkerArgs(checker, mode, payload) {
  if (checker === "check-answer-first" && mode === "post-edit") {
    const filePath = payload?.tool_input?.file_path;
    return filePath ? [filePath] : [];
  }
  return [];
}

function runChecker(checker, mode, payload) {
  const scriptPath = path.join(SCRIPTS_DIR, `${checker}.mjs`);
  const result = spawnSync(process.execPath, [scriptPath, ...checkerArgs(checker, mode, payload)], {
    stdio: "inherit",
  });
  return result.status ?? 0;
}

function readStdinPayload() {
  try {
    const raw = readFileSync(0, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function main() {
  const mode = process.argv[2];
  const payload = readStdinPayload();
  const checker = selectChecker(mode, payload);

  if (!checker) {
    process.exit(0);
  }

  const status = runChecker(checker, mode, payload);

  // Only the pre-push graph-integrity check may fail the tool call. Every
  // other checker (and every other mode) warns at most — its findings are
  // already printed by the child process, but they never block.
  if (mode === "pre-push" && checker === "check-graph-integrity") {
    process.exit(status);
  }

  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

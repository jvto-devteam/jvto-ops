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
import { ekosystemRoot, webRoot } from "./lib/repos.mjs";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

function toPosix(p) {
  return typeof p === "string" ? p.split(path.sep).join("/") : "";
}

// True when `target` (an absolute path) is `root` itself or somewhere
// beneath it. A substring test on the path string would also match a
// look-alike sibling — e.g. "/tmp/1-knowledge-and-evidence-core-backup"
// contains the substring "1-knowledge-and-evidence-core" but is not the
// repo. path.relative() plus a ".." check is what actually answers
// "is this inside the tree", including across a look-alike name.
function isWithin(root, target) {
  if (!root) return false;
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Shell metacharacters that separate one command invocation from the next.
// A checker must react to an actual invocation of `git push`, not to the
// words appearing anywhere in the command line — inside a quoted string
// (`echo "git push"`), inside a grep pattern (`grep -r "git push" .`), or as
// part of an unrelated word.
const SHELL_SEPARATOR_RE = /(?:&&|\|\||;|\||\n)/;

// A leading `VAR=value` assignment (repeatable — `A=1 B=2 git push`) and a
// leading `sudo` are both still an invocation of git, so both are stripped
// before testing the segment.
const LEADING_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/;
const LEADING_SUDO_RE = /^sudo\s+/;

// Deliberately also matches `git push --dry-run`: a dry run is a rehearsal
// of a push, and checking the graph before one is consistent and harmless,
// not a false positive — so this is left matching on purpose.
const GIT_PUSH_INVOCATION_RE = /^git(?:\s+-\S+)*\s+push\b/;

function isGitPushInvocation(segment) {
  let s = segment.trim();
  while (LEADING_ASSIGNMENT_RE.test(s)) {
    s = s.replace(LEADING_ASSIGNMENT_RE, "");
  }
  s = s.replace(LEADING_SUDO_RE, "");
  return GIT_PUSH_INVOCATION_RE.test(s);
}

function commandInvokesGitPush(command) {
  return command
    .split(SHELL_SEPARATOR_RE)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some(isGitPushInvocation);
}

/**
 * selectChecker(mode, payload) -> checker name | null
 *
 * mode: "post-edit" | "pre-push"
 * payload: the parsed hook JSON (the `tool_input` shape Claude Code sends
 * for PostToolUse/PreToolUse hooks).
 *
 * Repo roots are resolved the same way every checker resolves them
 * (lib/repos.mjs: env var, then sibling checkout) so a path is only ever
 * matched to a checker when it actually resolves inside the repo that
 * checker reads.
 */
export function selectChecker(mode, payload) {
  if (mode === "post-edit") {
    const rawPath = payload?.tool_input?.file_path;
    if (typeof rawPath !== "string" || !rawPath) return null;

    const filePath = path.resolve(rawPath);
    const posixPath = toPosix(filePath);
    const basename = posixPath.split("/").pop() ?? "";

    const eko = ekosystemRoot();
    const web = webRoot();

    if (
      isWithin(eko, filePath) &&
      posixPath.split("/").includes("1-knowledge-and-evidence-core") &&
      (posixPath.endsWith(".source.json") || posixPath.endsWith(".content.json"))
    ) {
      return "check-answer-first";
    }

    if (isWithin(path.join(web, "src"), filePath) && posixPath.endsWith(".tsx")) {
      return "check-ssot-drift";
    }

    if (
      (isWithin(eko, filePath) || isWithin(web, filePath)) &&
      (basename === "package.json" || posixPath.includes("/.github/workflows/"))
    ) {
      return "check-script-wiring";
    }

    return null;
  }

  if (mode === "pre-push") {
    const command = payload?.tool_input?.command;
    if (typeof command === "string" && commandInvokesGitPush(command)) {
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

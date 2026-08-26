#!/usr/bin/env node
// Dispatches Claude Code hook events to at most one checker.
//
// Policy (deliberate, not incidental):
//   - Everything warns; only check-graph-integrity may block. That checker
//     went through four review rounds to get its false-positive rate to
//     zero. The other three haven't earned blocking status, so a post-edit
//     dispatch never denies the tool call regardless of what the checker
//     found — its findings are surfaced instead via
//     hookSpecificOutput.additionalContext (see main()), which is the only
//     way a PostToolUse hook's output actually reaches the model: plain
//     stdout on exit 0 is not surfaced, and PostToolUse can't deny a tool
//     call anyway (the edit already happened).
//   - A `git push` denial is communicated via the documented JSON form on
//     stdout (hookSpecificOutput.permissionDecision: "deny"), not by
//     propagating an exit code. A PreToolUse hook does not block on exit 1
//     — only exit 2, or a JSON permissionDecision, blocks — and this
//     plugin's checkers use exit 1 for "found an error" (the same
//     lib/repos.mjs report() contract every checker shares), so relying on
//     the exit code here would silently never block anything.
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

    // .source.json lives anywhere under 1-knowledge-and-evidence-core, but
    // .content.json is specific to its destination-knowledge subdirectory —
    // check-answer-first's own CLI sweep (collectTargetFiles) only ever
    // walks destination-knowledge for *.content.json, so a look-alike
    // .content.json elsewhere in core (which the CLI sweep would never
    // check) must not fire this hook either. The two have to agree on what
    // "in scope" means.
    const segments = posixPath.split("/");
    if (
      isWithin(eko, filePath) &&
      segments.includes("1-knowledge-and-evidence-core") &&
      (posixPath.endsWith(".source.json") ||
        (posixPath.endsWith(".content.json") && segments.includes("destination-knowledge")))
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

/**
 * Runs a checker with --json and returns its parsed findings, never its raw
 * exit code — the hook contract this file speaks (permissionDecision /
 * additionalContext, both on stdout) is built from finding data, not from
 * propagating whatever exit code the child process happened to use for its
 * own CLI contract (0 clean, 1 error-level finding present — see
 * lib/repos.mjs report()). Mixing the two contracts is exactly how C1
 * happened: exit 1 means something different to a shell script than it does
 * to a PreToolUse hook.
 *
 * `skipped: true` (lib/repos.mjs reportSkippedRepo(), used when a sibling
 * repo isn't checked out) is distinguished from "ran and found nothing" —
 * both callers below treat a skip as nothing to report, never as a reason
 * to block or warn. Missing input is not a finding.
 *
 * The child's stderr is forwarded to this process's stderr (visible in
 * --debug logs) but never touches stdout, which must carry only the hook
 * JSON contract or nothing at all.
 */
function runCheckerJson(checker, mode, payload) {
  const scriptPath = path.join(SCRIPTS_DIR, `${checker}.mjs`);
  const args = [...checkerArgs(checker, mode, payload), "--json"];
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });

  if (result.error) {
    console.error(`hook-dispatch: could not run ${checker}: ${result.error.message}`);
    return { findings: [], skipped: false };
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  const stdout = (result.stdout ?? "").trim();
  if (!stdout) return { findings: [], skipped: false };

  try {
    const parsed = JSON.parse(stdout);
    if (parsed?.skipped) return { findings: [], skipped: true };
    return { findings: Array.isArray(parsed?.findings) ? parsed.findings : [], skipped: false };
  } catch {
    console.error(`hook-dispatch: could not parse ${checker}'s --json output`);
    return { findings: [], skipped: false };
  }
}

function formatFindings(checker, findings) {
  const lines = findings.map((f) => {
    const where = f.line === undefined ? f.file : `${f.file}:${f.line}`;
    return `${f.level.toUpperCase()} ${where} — ${f.message}`;
  });
  return `${checker}: ${lines.join("\n")}`;
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
    // Nothing has been written to this process's stdout yet — an
    // immediate exit here loses no output, so process.exit(0) is fine.
    process.exit(0);
  }

  const { findings, skipped } = runCheckerJson(checker, mode, payload);

  // A missing sibling repo is not a finding — nothing to block or warn
  // about, on either path below. Also fine to exit immediately: the
  // child's stdout was already fully captured (spawnSync is synchronous),
  // and this process itself hasn't written anything yet.
  if (skipped) {
    process.exit(0);
  }

  if (mode === "pre-push") {
    // Only check-graph-integrity is ever selected here (see
    // selectChecker), and it's the only checker cleared to block. The deny
    // decision is communicated via the documented JSON form on stdout —
    // see the file header for why this can't be an exit code.
    if (checker === "check-graph-integrity") {
      const errors = findings.filter((f) => f.level === "error");
      if (errors.length > 0) {
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: formatFindings(checker, errors),
            },
          }),
        );
      }
    }
    // return, not process.exit(0): the deny JSON just printed above can be
    // large (many findings), and process.exit() can tear this process down
    // before Node finishes flushing that async stdout write — the exact
    // truncation bug this fix wave exists to close, just one process up
    // from the checker. Returning lets main() finish and the event loop
    // drain stdout before Node exits (default exit code 0, which is what
    // every path in this function has always used).
    return;
  }

  if (mode === "post-edit") {
    // Every post-edit checker warns at most, findings of any level
    // included — PostToolUse can't deny a tool call that already happened,
    // and (per the checker-hygiene policy this plugin follows) only
    // check-graph-integrity has earned the right to block anything at all.
    // additionalContext is what actually reaches the model; plain stdout
    // on exit 0 does not.
    if (findings.length > 0) {
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: formatFindings(checker, findings),
          },
        }),
      );
    }
    // return, not process.exit(0): same reasoning as the pre-push branch
    // above — additionalContext can be large, and process.exit() risks
    // truncating it before it's flushed.
    return;
  }

  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

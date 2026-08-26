// Repo discovery for a plugin that lives outside the repos it inspects.
//
// Mirrors the convention jvto-web already uses in
// src/lib/ecosystemContent/*.ts: an explicit env var wins, otherwise assume a
// sibling checkout next to the current working directory. Nothing here writes
// to those repos — checkers report, skills edit.
//
// Precedence for every root getter: an explicit `--repo-root` override (see
// `rootOverride`), then the env var, then the sibling-checkout default.
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const ENV = {
  ekosistem: "JVTO_EKOSYSTEM_ROOT",
  web: "JVTO_WEB_ROOT",
};

function sibling(name) {
  return path.resolve(process.cwd(), "..", name);
}

/**
 * Reads `<flag> <path>` from argv so every checker can accept the same kind
 * of override without re-parsing it. Returns the resolved absolute path, or
 * `null` when the flag is absent (or has no value after it). Defaults to
 * `--repo-root`, which the single-repo checkers (check-answer-first,
 * check-graph-integrity, check-ssot-drift) use; check-script-wiring — the
 * one checker that reads both repos — passes `--web-root` / `--ekosistem-root`
 * instead, so a single override can no longer be mistaken for both roots at
 * once.
 */
export function rootOverride(argv = process.argv.slice(2), flag = "--repo-root") {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? path.resolve(argv[i + 1]) : null;
}

export function ekosystemRoot(override) {
  return override ?? process.env[ENV.ekosistem] ?? sibling("jvto-ekosistem");
}

export function webRoot(override) {
  return override ?? process.env[ENV.web] ?? sibling("jvto-web");
}

/**
 * Thrown by requireRepo() when a repo isn't where it's expected. Its own
 * class, not a plain Error, so a CLI entry point can tell "the sibling repo
 * isn't checked out" apart from an actual bug in the checker. The former is
 * routine — a fresh checkout, a git worktree, CI running this plugin
 * without both siblings present — and must degrade to a quiet skip, never a
 * crash or (worse, on the pre-push path) a denied push. Missing input is
 * not a finding.
 */
export class RepoNotFoundError extends Error {
  constructor(label, dir, envVar) {
    super(
      `Cannot find the ${label} repository at ${dir}. ` +
        `Set ${envVar} to its absolute path, or run from a directory whose sibling is the checkout.`,
    );
    this.name = "RepoNotFoundError";
    this.label = label;
    this.dir = dir;
  }
}

export function requireRepo(label, dir) {
  const envVar = ENV[label] ?? `JVTO_${label.toUpperCase()}_ROOT`;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new RepoNotFoundError(label, dir, envVar);
  }
  return dir;
}

export function finding(level, file, message, line) {
  return line === undefined ? { level, file, message } : { level, file, message, line };
}

/**
 * Shared output contract so hooks can treat every checker the same way.
 * Exit 0 = nothing blocking. Exit 1 = at least one error-level finding.
 * Warnings are printed but never fail — a checker that cries wolf gets muted,
 * and a muted checker is worse than no checker.
 */
export function report(checker, findings, argv = process.argv.slice(2)) {
  const exitCode = findings.some((f) => f.level === "error") ? 1 : 0;

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ checker, findings }, null, 2));
    return exitCode;
  }

  if (findings.length === 0) {
    console.log(`${checker}: clean`);
    return exitCode;
  }

  for (const f of findings) {
    const where = f.line === undefined ? f.file : `${f.file}:${f.line}`;
    console.log(`${f.level.toUpperCase().padEnd(5)} ${where} — ${f.message}`);
  }
  const errors = findings.filter((f) => f.level === "error").length;
  const warns = findings.length - errors;
  console.log(`${checker}: ${errors} error(s), ${warns} warning(s)`);
  return exitCode;
}

/**
 * The "missing input is not a finding" notice: printed instead of running
 * report() at all, since a repo that isn't checked out produced zero
 * findings, not a clean scan. Mirrors report()'s two output shapes (plain
 * text, or a single JSON line under --json) so a caller parsing stdout
 * (hook-dispatch, in --json mode) can tell "skipped" apart from "ran and
 * found nothing" without guessing from an empty findings array.
 */
export function reportSkippedRepo(checker, err, argv = process.argv.slice(2)) {
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ checker, skipped: true, reason: err.message }));
    return;
  }
  console.log(`${checker}: skipped — ${err.message}`);
}

/**
 * Every checker's CLI entry point runs through this instead of calling
 * main() directly, so a missing sibling repo degrades to exit 0 with the
 * skip notice above instead of an unhandled rejection, a raw stack trace,
 * and (on the pre-push path, before hook-dispatch stopped trusting exit
 * codes) a denied `git push` every time a worktree happened to be missing
 * one sibling. `fn` may be sync or async — wrapping the call in
 * Promise.resolve().then() lets one .catch() handle both.
 *
 * Any OTHER error (an actual bug, not a missing repo) still surfaces — to
 * stderr, with exit 1 — rather than being swallowed the same way. Only
 * "repo not found" is treated as routine.
 */
export function runCli(checkerName, fn) {
  Promise.resolve()
    .then(fn)
    .catch((err) => {
      if (err instanceof RepoNotFoundError) {
        // process.exitCode, not process.exit(): reportSkippedRepo() writes
        // to stdout (the --json skip line hook-dispatch.mjs parses), and
        // process.exit() can tear the process down before that async write
        // finishes flushing — the same truncation risk as report()'s output,
        // just on a shorter payload. exitCode lets it drain naturally.
        reportSkippedRepo(checkerName, err);
        process.exitCode = 0;
        return;
      }
      // console.error() writes to stderr, not the stdout hook-dispatch.mjs
      // parses, and nothing has been written to stdout on this path — an
      // immediate exit here loses no output.
      console.error(err?.stack ?? String(err));
      process.exit(1);
    });
}

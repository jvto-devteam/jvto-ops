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
  platform: "JVTO_PLATFORM_ROOT",
};

function sibling(name) {
  return path.resolve(process.cwd(), "..", name);
}

/**
 * Reads `--repo-root <path>` from argv so every checker can accept the same
 * flag without re-parsing it. Returns the resolved absolute path, or `null`
 * when the flag is absent (or has no value after it).
 */
export function rootOverride(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--repo-root");
  return i !== -1 && argv[i + 1] ? path.resolve(argv[i + 1]) : null;
}

export function ekosystemRoot(override) {
  return override ?? process.env[ENV.ekosistem] ?? sibling("jvto-ekosistem");
}

export function webRoot(override) {
  return override ?? process.env[ENV.web] ?? sibling("jvto-web");
}

export function platformRoot(override) {
  const dir = override ?? process.env[ENV.platform] ?? sibling("jvto-platform");
  return existsSync(dir) ? dir : null;
}

export function requireRepo(label, dir) {
  const envVar = ENV[label] ?? `JVTO_${label.toUpperCase()}_ROOT`;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(
      `Cannot find the ${label} repository at ${dir}. ` +
        `Set ${envVar} to its absolute path, or run from a directory whose sibling is the checkout.`,
    );
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

// Package-script wiring: catches two divergences between what CI workflows
// call and what package.json defines.
//
//   1. A workflow calls `npm run <name>` for a script package.json doesn't
//      have. Unambiguously broken — the workflow step fails at runtime the
//      moment it runs. Always an error.
//   2. A script named audit:*, validate:*, or check:* that no workflow runs
//      at all. This might be a deliberate manual-only tool, or it might be
//      forgotten wiring — either way it's a judgment call the repo owner
//      gets to make, not something this checker can be sure about. Always a
//      warning, never an error: a checker that blocks on taste gets muted,
//      and a muted checker is worse than none.
//
// Pure logic lives in checkWiring() so tests exercise it against fixtures
// with no I/O. The CLI wrapper below reads <repo>/package.json and every
// file under <repo>/.github/workflows, once for jvto-web and once for
// jvto-ekosistem.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  finding,
  report,
  ekosystemRoot,
  webRoot,
  requireRepo,
  rootOverride,
  runCli,
} from "./lib/repos.mjs";

// Scripts confirmed manual-only FOR NOW — deliberately not wired into any
// workflow. This is not a permanent exemption: the intent is for this list
// to shrink as each entry either gets wired in or is retired, not to grow
// into a place unwired scripts go to be forgotten.
//
// Scoped per repo, not shared across both: a name exempted here for
// jvto-web must not silently exempt a same-named script that jvto-ekosistem
// might one day define for an unrelated reason. Each entry carries `why`
// and `addedOn` — mirroring the bar scripts/consumer-defined-ids.json
// already sets — so a reader can tell whether an entry has outlived its
// reason instead of trusting a bare name forever.
export const ALLOW_MANUAL = {
  web: [
    {
      name: "audit:geo-visibility",
      why: "Manual/weekly generative-visibility audit against the live site; not something a per-push CI gate should run.",
      addedOn: "2026-08-20",
    },
    {
      name: "audit:travel-guide:live",
      why: "Fetches the live site to check travel-guide parity; a manual spot-check, not a CI-safe deterministic step.",
      addedOn: "2026-08-20",
    },
    {
      name: "check:fact-drift",
      why: "Manual fact-drift sweep against live/external sources; not wired into CI because it depends on state outside the repo.",
      addedOn: "2026-08-20",
    },
  ],
  ekosistem: [],
};

const ORPHAN_PREFIXES = ["audit:", "validate:", "check:"];
const NPM_RUN_RE = /\bnpm run ([A-Za-z0-9_:.-]+)/g;

function extractCalledScripts(workflowText) {
  const called = new Set();
  for (const m of workflowText.matchAll(NPM_RUN_RE)) {
    called.add(m[1]);
  }
  return called;
}

/**
 * checkWiring(pkgScripts, workflowText, { allowManual, repoLabel })
 *
 * pkgScripts: the parsed `scripts` object from a package.json.
 * workflowText: every workflow file's text concatenated together — callers
 * don't need per-file attribution here, just which script names appear.
 * allowManual: script names exempted from the orphan warning (plain
 * strings — the per-repo `why`/`addedOn` metadata in ALLOW_MANUAL is a
 * bookkeeping concern for main()'s config, not this pure-logic function).
 * repoLabel: when given, prefixes every finding's `file` (e.g.
 * "web/package.json") so two otherwise-identical findings from different
 * repos in the same run are distinguishable. Omitted, `file` stays the bare
 * "package.json" — existing single-repo callers (tests) are unaffected.
 */
export function checkWiring(pkgScripts, workflowText, { allowManual = [], repoLabel } = {}) {
  const findings = [];
  const called = extractCalledScripts(workflowText);
  const allowSet = new Set(allowManual);
  const file = repoLabel ? `${repoLabel}/package.json` : "package.json";

  for (const name of called) {
    if (!(name in pkgScripts)) {
      findings.push(
        finding(
          "error",
          file,
          `workflow calls \`npm run ${name}\` but package.json has no such script`,
        ),
      );
    }
  }

  for (const name of Object.keys(pkgScripts)) {
    if (!ORPHAN_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    if (called.has(name)) continue;
    if (allowSet.has(name)) continue;
    findings.push(
      finding(
        "warn",
        file,
        `\`${name}\` is defined but no workflow runs it — wire it or add it to allowManual`,
      ),
    );
  }

  return findings;
}

function readPkgScripts(root) {
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {};
  } catch {
    return {};
  }
}

function readWorkflowText(root) {
  const dir = path.join(root, ".github", "workflows");
  if (!existsSync(dir)) return "";
  return readdirSync(dir, { recursive: true })
    .filter((entry) => /\.ya?ml$/i.test(entry))
    .map((entry) => readFileSync(path.join(dir, entry), "utf8"))
    .join("\n");
}

function allowManualNames(repoLabel) {
  return (ALLOW_MANUAL[repoLabel] ?? []).map((entry) => entry.name);
}

function main() {
  const argv = process.argv.slice(2);

  // This is the one checker that reads both repos, so a single --repo-root
  // can't disambiguate which root it's for — --web-root/--ekosistem-root
  // replace it here. (The single-repo checkers keep using --repo-root
  // unchanged.)
  const web = requireRepo("web", webRoot(rootOverride(argv, "--web-root")));
  const ekosistem = requireRepo("ekosistem", ekosystemRoot(rootOverride(argv, "--ekosistem-root")));

  const findings = [
    ...checkWiring(readPkgScripts(web), readWorkflowText(web), {
      allowManual: allowManualNames("web"),
      repoLabel: "web",
    }),
    ...checkWiring(readPkgScripts(ekosistem), readWorkflowText(ekosistem), {
      allowManual: allowManualNames("ekosistem"),
      repoLabel: "ekosistem",
    }),
  ];

  // process.exitCode, not process.exit(): see check-graph-integrity.mjs for
  // why — process.exit() can truncate a large --json write before
  // hook-dispatch.mjs finishes reading it over spawnSync.
  process.exitCode = report("check-script-wiring", findings, argv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli("check-script-wiring", main);
}

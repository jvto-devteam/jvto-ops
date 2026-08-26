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
} from "./lib/repos.mjs";

// Scripts confirmed manual-only FOR NOW — deliberately not wired into any
// workflow. This is not a permanent exemption: the intent is for this list
// to shrink as each entry either gets wired in or is retired, not to grow
// into a place unwired scripts go to be forgotten.
export const DEFAULT_ALLOW_MANUAL = [
  "audit:geo-visibility",
  "audit:travel-guide:live",
  "check:fact-drift",
];

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
 * checkWiring(pkgScripts, workflowText, { allowManual })
 *
 * pkgScripts: the parsed `scripts` object from a package.json.
 * workflowText: every workflow file's text concatenated together — callers
 * don't need per-file attribution here, just which script names appear.
 * allowManual: script names exempted from the orphan warning.
 */
export function checkWiring(pkgScripts, workflowText, { allowManual = [] } = {}) {
  const findings = [];
  const called = extractCalledScripts(workflowText);
  const allowSet = new Set(allowManual);

  for (const name of called) {
    if (!(name in pkgScripts)) {
      findings.push(
        finding(
          "error",
          "package.json",
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
        "package.json",
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

function main() {
  const argv = process.argv.slice(2);
  const override = rootOverride(argv);

  const web = requireRepo("web", webRoot(override));
  const ekosistem = requireRepo("ekosistem", ekosystemRoot(override));

  const findings = [
    ...checkWiring(readPkgScripts(web), readWorkflowText(web), {
      allowManual: DEFAULT_ALLOW_MANUAL,
    }),
    ...checkWiring(readPkgScripts(ekosistem), readWorkflowText(ekosistem), {
      allowManual: DEFAULT_ALLOW_MANUAL,
    }),
  ];

  process.exit(report("check-script-wiring", findings, argv));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

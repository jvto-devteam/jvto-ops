import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkWiring } from "../scripts/check-script-wiring.mjs";

const pkg = JSON.parse(readFileSync(new URL("./fixtures/wiring/package.json", import.meta.url)));
const wf = readFileSync(new URL("./fixtures/wiring/workflows/ci.yml", import.meta.url), "utf8");

test("a workflow calling a script that does not exist is an error", () => {
  const findings = checkWiring(pkg.scripts, wf, { allowManual: [] });
  const missing = findings.filter((f) => f.level === "error");
  assert.equal(missing.length, 1);
  assert.ok(missing[0].message.includes("sync:trust"));
});

test("an audit script no workflow calls is a warning, not an error", () => {
  const findings = checkWiring(pkg.scripts, wf, { allowManual: [] });
  const orphan = findings.find((f) => f.message.includes("audit:geo-visibility"));
  assert.equal(orphan.level, "warn");
});

test("a script on the manual allowlist is not reported as orphaned", () => {
  const findings = checkWiring(pkg.scripts, wf, { allowManual: ["audit:geo-visibility"] });
  assert.ok(!findings.some((f) => f.message.includes("audit:geo-visibility")));
});

test("non-audit scripts are never reported as orphaned", () => {
  const findings = checkWiring(pkg.scripts, wf, { allowManual: [] });
  assert.ok(!findings.some((f) => f.message.includes("build")));
});

// I2: two repos producing the identical message ("package.json — `x` is
// defined but no workflow runs it") were indistinguishable in the default
// two-repo run. repoLabel prefixes the file so they aren't.
test("repoLabel prefixes findings so two repos' identical messages are distinguishable", () => {
  const withoutLabel = checkWiring(pkg.scripts, wf, { allowManual: [] });
  assert.ok(withoutLabel.every((f) => f.file === "package.json"));

  const withLabel = checkWiring(pkg.scripts, wf, { allowManual: [], repoLabel: "web" });
  assert.ok(withLabel.length > 0);
  assert.ok(withLabel.every((f) => f.file === "web/package.json"));
});

function makeRepo(prefix, { scripts, workflowCalls }) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: prefix, scripts }));
  const wfDir = path.join(dir, ".github", "workflows");
  mkdirSync(wfDir, { recursive: true });
  const steps = workflowCalls.map((name) => `      - run: npm run ${name}`).join("\n");
  writeFileSync(
    path.join(wfDir, "ci.yml"),
    `name: CI\non: [push]\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n${steps}\n`,
  );
  return dir;
}

const SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "check-script-wiring.mjs",
);

// I1: --repo-root used to be handed to both webRoot() and ekosystemRoot(),
// so a single override pointed BOTH repos at the same directory and every
// finding from it was emitted twice (once "as web", once "as ekosistem").
// --web-root/--ekosistem-root replace it so each root resolves
// independently; this pins that they actually do.
test("--web-root and --ekosistem-root resolve independently, not to the same override", () => {
  const webDir = makeRepo("jvto-ops-test-wiring-web-", {
    scripts: { "audit:only-in-web": "node scripts/x.mjs" },
    workflowCalls: [],
  });
  const ekoDir = makeRepo("jvto-ops-test-wiring-eko-", {
    scripts: { build: "true" },
    workflowCalls: [],
  });
  try {
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--web-root", webDir, "--ekosistem-root", ekoDir, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    const hits = parsed.findings.filter((f) => f.message.includes("audit:only-in-web"));
    // Exactly one finding, attributed to web — not two (one per repo) from
    // both roots resolving to the same directory.
    assert.equal(hits.length, 1);
    assert.equal(hits[0].file, "web/package.json");
  } finally {
    rmSync(webDir, { recursive: true, force: true });
    rmSync(ekoDir, { recursive: true, force: true });
  }
});

test("a missing sibling repo exits 0 with a skip notice, not a crash", () => {
  const missingWeb = path.join(tmpdir(), "jvto-ops-test-missing-web-4711");
  const missingEko = path.join(tmpdir(), "jvto-ops-test-missing-eko-4711");
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    encoding: "utf8",
    env: {
      ...process.env,
      JVTO_WEB_ROOT: missingWeb,
      JVTO_EKOSYSTEM_ROOT: missingEko,
    },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped/);
});

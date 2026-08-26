import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

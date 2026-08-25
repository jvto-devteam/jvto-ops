import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ekosystemRoot, requireRepo, finding, report } from "../scripts/lib/repos.mjs";

test("ekosystemRoot prefers the env var", () => {
  process.env.JVTO_EKOSYSTEM_ROOT = "/tmp/explicit-eko";
  assert.equal(ekosystemRoot(), "/tmp/explicit-eko");
  delete process.env.JVTO_EKOSYSTEM_ROOT;
});

test("requireRepo names the env var when the directory is missing", () => {
  assert.throws(
    () => requireRepo("ekosistem", "/tmp/definitely-not-here-4711"),
    /JVTO_EKOSYSTEM_ROOT|ekosistem/,
  );
});

test("requireRepo returns the directory when it exists", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jvto-ops-"));
  mkdirSync(path.join(dir, "sub"));
  assert.equal(requireRepo("ekosistem", dir), dir);
});

test("report exits 1 only when an error-level finding is present", () => {
  assert.equal(report("demo", [], []), 0);
  assert.equal(report("demo", [finding("warn", "a.json", "just a note")], []), 0);
  assert.equal(report("demo", [finding("error", "a.json", "broken")], []), 1);
});

test("report emits parseable JSON under --json", () => {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  report("demo", [finding("error", "a.json", "broken", 12)], ["--json"]);
  console.log = original;
  const parsed = JSON.parse(lines.join("\n"));
  assert.equal(parsed.checker, "demo");
  assert.equal(parsed.findings[0].line, 12);
});

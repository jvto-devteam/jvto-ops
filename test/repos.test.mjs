import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ekosystemRoot,
  webRoot,
  platformRoot,
  rootOverride,
  requireRepo,
  finding,
  report,
} from "../scripts/lib/repos.mjs";

test("ekosystemRoot prefers the env var", () => {
  process.env.JVTO_EKOSYSTEM_ROOT = "/tmp/explicit-eko";
  assert.equal(ekosystemRoot(), "/tmp/explicit-eko");
  delete process.env.JVTO_EKOSYSTEM_ROOT;
});

test("ekosystemRoot precedence: override, then env var, then sibling default", () => {
  process.env.JVTO_EKOSYSTEM_ROOT = "/tmp/env-eko";
  assert.equal(ekosystemRoot("/tmp/override-eko"), "/tmp/override-eko");
  assert.equal(ekosystemRoot(), "/tmp/env-eko");
  delete process.env.JVTO_EKOSYSTEM_ROOT;
  assert.equal(ekosystemRoot(), path.resolve(process.cwd(), "..", "jvto-ekosistem"));
});

test("webRoot precedence: override, then env var, then sibling default", () => {
  process.env.JVTO_WEB_ROOT = "/tmp/env-web";
  assert.equal(webRoot("/tmp/override-web"), "/tmp/override-web");
  assert.equal(webRoot(), "/tmp/env-web");
  delete process.env.JVTO_WEB_ROOT;
  assert.equal(webRoot(), path.resolve(process.cwd(), "..", "jvto-web"));
});

test("platformRoot precedence: override, then env var, then sibling default", () => {
  const overrideDir = mkdtempSync(path.join(tmpdir(), "jvto-ops-override-"));
  const envDir = mkdtempSync(path.join(tmpdir(), "jvto-ops-env-"));
  process.env.JVTO_PLATFORM_ROOT = envDir;
  assert.equal(platformRoot(overrideDir), overrideDir);
  assert.equal(platformRoot(), envDir);
  delete process.env.JVTO_PLATFORM_ROOT;
  // No sibling jvto-platform checkout exists next to this repo, so the
  // default resolves to a directory that doesn't exist and null is correct.
  assert.equal(platformRoot(), null);
});

test("rootOverride returns null when --repo-root is absent", () => {
  assert.equal(rootOverride([]), null);
  assert.equal(rootOverride(["--json"]), null);
});

test("rootOverride resolves the path that follows --repo-root", () => {
  assert.equal(
    rootOverride(["--repo-root", "/tmp/somewhere"]),
    path.resolve("/tmp/somewhere"),
  );
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

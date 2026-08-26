import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ekosystemRoot,
  webRoot,
  rootOverride,
  requireRepo,
  RepoNotFoundError,
  reportSkippedRepo,
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

// I1: check-script-wiring needs two independent overrides (one per repo),
// not the single --repo-root every other checker uses. rootOverride's
// second argument lets a caller name its own flag instead.
test("rootOverride resolves a caller-named flag, independent of --repo-root", () => {
  assert.equal(
    rootOverride(["--web-root", "/tmp/web-here", "--repo-root", "/tmp/ignored"], "--web-root"),
    path.resolve("/tmp/web-here"),
  );
  assert.equal(rootOverride(["--repo-root", "/tmp/ignored"], "--web-root"), null);
});

test("requireRepo names the env var when the directory is missing", () => {
  assert.throws(
    () => requireRepo("ekosistem", "/tmp/definitely-not-here-4711"),
    /JVTO_EKOSYSTEM_ROOT|ekosistem/,
  );
});

test("requireRepo throws a RepoNotFoundError specifically, not a plain Error", () => {
  assert.throws(
    () => requireRepo("ekosistem", "/tmp/definitely-not-here-4711"),
    (err) => err instanceof RepoNotFoundError,
  );
});

test("requireRepo returns the directory when it exists", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jvto-ops-"));
  mkdirSync(path.join(dir, "sub"));
  assert.equal(requireRepo("ekosistem", dir), dir);
});

test("reportSkippedRepo prints a plain skip line by default", () => {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    reportSkippedRepo("demo", new RepoNotFoundError("ekosistem", "/nowhere", "JVTO_EKOSYSTEM_ROOT"), []);
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^demo: skipped/);
});

test("reportSkippedRepo emits parseable JSON with skipped: true under --json", () => {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    reportSkippedRepo(
      "demo",
      new RepoNotFoundError("ekosistem", "/nowhere", "JVTO_EKOSYSTEM_ROOT"),
      ["--json"],
    );
  } finally {
    console.log = original;
  }
  const parsed = JSON.parse(lines.join("\n"));
  assert.equal(parsed.checker, "demo");
  assert.equal(parsed.skipped, true);
  assert.match(parsed.reason, /ekosistem/);
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

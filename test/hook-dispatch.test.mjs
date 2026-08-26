import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { selectChecker } from "../scripts/hook-dispatch.mjs";

// Fixed, isolated repo roots so path-containment tests don't depend on
// whatever real sibling checkouts happen to exist next to this repo.
let ekoRoot;
let webRoot;
let prevEko;
let prevWeb;

before(() => {
  ekoRoot = mkdtempSync(path.join(tmpdir(), "jvto-ops-test-eko-"));
  webRoot = mkdtempSync(path.join(tmpdir(), "jvto-ops-test-web-"));
  prevEko = process.env.JVTO_EKOSYSTEM_ROOT;
  prevWeb = process.env.JVTO_WEB_ROOT;
  process.env.JVTO_EKOSYSTEM_ROOT = ekoRoot;
  process.env.JVTO_WEB_ROOT = webRoot;
});

after(() => {
  if (prevEko === undefined) delete process.env.JVTO_EKOSYSTEM_ROOT;
  else process.env.JVTO_EKOSYSTEM_ROOT = prevEko;
  if (prevWeb === undefined) delete process.env.JVTO_WEB_ROOT;
  else process.env.JVTO_WEB_ROOT = prevWeb;
  rmSync(ekoRoot, { recursive: true, force: true });
  rmSync(webRoot, { recursive: true, force: true });
});

test("post-edit on a .tsx under jvto-web/src selects check-ssot-drift", () => {
  const payload = {
    tool_input: { file_path: path.join(webRoot, "src", "app", "destinations", "page.tsx") },
  };
  assert.equal(selectChecker("post-edit", payload), "check-ssot-drift");
});

test("post-edit on a README selects nothing", () => {
  const payload = { tool_input: { file_path: path.join(ekoRoot, "README.md") } };
  assert.equal(selectChecker("post-edit", payload), null);
});

test("pre-push whose command is git status selects nothing", () => {
  const payload = { tool_input: { command: "git status" } };
  assert.equal(selectChecker("pre-push", payload), null);
});

test("post-edit on a .source.json under 1-knowledge-and-evidence-core selects check-answer-first", () => {
  const payload = {
    tool_input: {
      file_path: path.join(ekoRoot, "1-knowledge-and-evidence-core", "ijen.source.json"),
    },
  };
  assert.equal(selectChecker("post-edit", payload), "check-answer-first");
});

test("post-edit on a .content.json under destination-knowledge selects check-answer-first", () => {
  const payload = {
    tool_input: {
      file_path: path.join(
        ekoRoot,
        "1-knowledge-and-evidence-core",
        "destination-knowledge",
        "ijen.content.json",
      ),
    },
  };
  assert.equal(selectChecker("post-edit", payload), "check-answer-first");
});

test("post-edit on package.json selects check-script-wiring", () => {
  const payload = { tool_input: { file_path: path.join(webRoot, "package.json") } };
  assert.equal(selectChecker("post-edit", payload), "check-script-wiring");
});

test("post-edit under .github/workflows selects check-script-wiring", () => {
  const payload = {
    tool_input: { file_path: path.join(webRoot, ".github", "workflows", "deploy.yml") },
  };
  assert.equal(selectChecker("post-edit", payload), "check-script-wiring");
});

test("post-edit on a .tsx outside jvto-web/src selects nothing", () => {
  const payload = { tool_input: { file_path: "/tmp/some-other-app/src/page.tsx" } };
  assert.equal(selectChecker("post-edit", payload), null);
});

test("post-edit with no file_path selects nothing", () => {
  assert.equal(selectChecker("post-edit", { tool_input: {} }), null);
});

test("a look-alike directory name outside the repo root selects nothing", () => {
  // Shares the substring "1-knowledge-and-evidence-core" with the real repo
  // path but is not inside ekoRoot — a substring test would wrongly select
  // check-answer-first here; containment must rule it out.
  const payload = {
    tool_input: {
      file_path: path.join(
        `${ekoRoot}-backup`,
        "1-knowledge-and-evidence-core",
        "x.source.json",
      ),
    },
  };
  assert.equal(selectChecker("post-edit", payload), null);
});

test("pre-push whose command is git push selects check-graph-integrity", () => {
  const payload = { tool_input: { command: "git push origin main" } };
  assert.equal(selectChecker("pre-push", payload), "check-graph-integrity");
});

test('pre-push whose command merely echoes the words "git push" selects nothing', () => {
  const payload = { tool_input: { command: 'echo "git push"' } };
  assert.equal(selectChecker("pre-push", payload), null);
});

test('pre-push whose command greps for "git push" selects nothing', () => {
  const payload = { tool_input: { command: 'grep -r "git push" .' } };
  assert.equal(selectChecker("pre-push", payload), null);
});

test("pre-push whose command chains an unrelated step before a real git push selects check-graph-integrity", () => {
  const payload = { tool_input: { command: "npm test && git push origin main" } };
  assert.equal(selectChecker("pre-push", payload), "check-graph-integrity");
});

test("pre-push whose command has a leading env assignment before git push selects check-graph-integrity", () => {
  const payload = { tool_input: { command: "GIT_TRACE=1 git push" } };
  assert.equal(selectChecker("pre-push", payload), "check-graph-integrity");
});

test("pre-push whose command is a dry-run push still selects check-graph-integrity (deliberate — a rehearsal of a push)", () => {
  const payload = { tool_input: { command: "git push --dry-run" } };
  assert.equal(selectChecker("pre-push", payload), "check-graph-integrity");
});

test("an unknown mode selects nothing", () => {
  assert.equal(selectChecker("something-else", { tool_input: { file_path: "x.tsx" } }), null);
});

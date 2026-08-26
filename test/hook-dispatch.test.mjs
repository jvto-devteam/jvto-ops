import { test } from "node:test";
import assert from "node:assert/strict";
import { selectChecker } from "../scripts/hook-dispatch.mjs";

test("post-edit on a .tsx under jvto-web/src selects check-ssot-drift", () => {
  const payload = {
    tool_input: { file_path: "/Users/dev/jvto-web/src/app/destinations/page.tsx" },
  };
  assert.equal(selectChecker("post-edit", payload), "check-ssot-drift");
});

test("post-edit on a README selects nothing", () => {
  const payload = { tool_input: { file_path: "/Users/dev/jvto-ekosistem/README.md" } };
  assert.equal(selectChecker("post-edit", payload), null);
});

test("pre-push whose command is git status selects nothing", () => {
  const payload = { tool_input: { command: "git status" } };
  assert.equal(selectChecker("pre-push", payload), null);
});

test("post-edit on a .source.json under 1-knowledge-and-evidence-core selects check-answer-first", () => {
  const payload = {
    tool_input: {
      file_path: "/repo/jvto-ekosistem/1-knowledge-and-evidence-core/ijen.source.json",
    },
  };
  assert.equal(selectChecker("post-edit", payload), "check-answer-first");
});

test("post-edit on a .content.json under destination-knowledge selects check-answer-first", () => {
  const payload = {
    tool_input: {
      file_path:
        "/repo/jvto-ekosistem/1-knowledge-and-evidence-core/destination-knowledge/ijen.content.json",
    },
  };
  assert.equal(selectChecker("post-edit", payload), "check-answer-first");
});

test("post-edit on package.json selects check-script-wiring", () => {
  const payload = { tool_input: { file_path: "/repo/jvto-web/package.json" } };
  assert.equal(selectChecker("post-edit", payload), "check-script-wiring");
});

test("post-edit under .github/workflows selects check-script-wiring", () => {
  const payload = { tool_input: { file_path: "/repo/jvto-web/.github/workflows/deploy.yml" } };
  assert.equal(selectChecker("post-edit", payload), "check-script-wiring");
});

test("post-edit on a .tsx outside jvto-web/src selects nothing", () => {
  const payload = { tool_input: { file_path: "/repo/some-other-app/src/page.tsx" } };
  assert.equal(selectChecker("post-edit", payload), null);
});

test("post-edit with no file_path selects nothing", () => {
  assert.equal(selectChecker("post-edit", { tool_input: {} }), null);
});

test("pre-push whose command is git push selects check-graph-integrity", () => {
  const payload = { tool_input: { command: "git push origin main" } };
  assert.equal(selectChecker("pre-push", payload), "check-graph-integrity");
});

test("an unknown mode selects nothing", () => {
  assert.equal(selectChecker("something-else", { tool_input: { file_path: "x.tsx" } }), null);
});

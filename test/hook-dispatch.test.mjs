import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

test("post-edit on a .content.json outside destination-knowledge selects nothing", () => {
  // check-answer-first's own CLI sweep (collectTargetFiles) only ever walks
  // destination-knowledge for *.content.json — a look-alike .content.json
  // sitting elsewhere in 1-knowledge-and-evidence-core is never part of
  // that sweep, so this hook must not fire on it either. Before this fix,
  // hook-dispatch matched any .content.json anywhere under core.
  const payload = {
    tool_input: {
      file_path: path.join(
        ekoRoot,
        "1-knowledge-and-evidence-core",
        "some-other-section",
        "x.content.json",
      ),
    },
  };
  assert.equal(selectChecker("post-edit", payload), null);
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

// CLI-level tests: the actual JSON hook-dispatch prints on its own stdout,
// which is what C1/C2/C3 are about. selectChecker() being right doesn't
// prove the process actually denies a push or surfaces a warning — these
// spawn the real dispatcher and read what it wrote.
const HOOK_DISPATCH_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "hook-dispatch.mjs",
);

function runDispatch(mode, payload, env) {
  return spawnSync(process.execPath, [HOOK_DISPATCH_PATH, mode], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("pre-push against a repo with a real dangling reference produces the deny JSON, exit 0", () => {
  const repoDir = mkdtempSync(path.join(tmpdir(), "jvto-ops-test-dispatch-dangling-"));
  try {
    const pagesDir = path.join(repoDir, "5-experience-engine", "json-ld", "pages");
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(
      path.join(pagesDir, "x.schema-output.json"),
      JSON.stringify({
        json_ld: {
          "@graph": [
            {
              "@id": "https://javavolcano-touroperator.com/#org",
              "@type": "Organization",
              "name": "X",
              publisher: { "@id": "https://javavolcano-touroperator.com/#missing" },
            },
          ],
        },
      }),
    );

    const result = runDispatch(
      "pre-push",
      { tool_input: { command: "git push origin main" } },
      { JVTO_EKOSYSTEM_ROOT: repoDir },
    );

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /never defined/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("pre-push against a missing ekosistem repo does not deny — missing input is not a finding", () => {
  const missingDir = path.join(tmpdir(), "jvto-ops-test-dispatch-missing-repo-4711");
  const result = runDispatch(
    "pre-push",
    { tool_input: { command: "git push origin main" } },
    { JVTO_EKOSYSTEM_ROOT: missingDir },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "");
});

test("pre-push against a clean repo produces no output and does not deny", () => {
  const repoDir = mkdtempSync(path.join(tmpdir(), "jvto-ops-test-dispatch-clean-"));
  try {
    const pagesDir = path.join(repoDir, "5-experience-engine", "json-ld", "pages");
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(
      path.join(pagesDir, "x.schema-output.json"),
      JSON.stringify({
        json_ld: {
          "@graph": [
            {
              "@id": "https://javavolcano-touroperator.com/#org",
              "@type": "Organization",
              "name": "X",
            },
          ],
        },
      }),
    );

    const result = runDispatch(
      "pre-push",
      { tool_input: { command: "git push origin main" } },
      { JVTO_EKOSYSTEM_ROOT: repoDir },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "");
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("post-edit with a warn-level finding produces additionalContext, exit 0", () => {
  const repoDir = mkdtempSync(path.join(tmpdir(), "jvto-ops-test-dispatch-warn-"));
  try {
    const dkDir = path.join(repoDir, "1-knowledge-and-evidence-core", "destination-knowledge");
    mkdirSync(dkDir, { recursive: true });
    const filePath = path.join(dkDir, "x.content.json");
    // Fact-poor (fluff-only) prose in the 40-60 word range: this fires only
    // the fact-count and fluff-adjective findings, both warn-level — no
    // error-level finding at all, so this pins that a purely-warn result
    // still surfaces via additionalContext, not silence.
    writeFileSync(
      filePath,
      JSON.stringify({
        answerFirst:
          "Kawah Ijen is a truly breathtaking destination and an unforgettable experience for every traveller. The stunning blue fire is the best sight in East Java, and our professional team makes it a once-in-a-lifetime trip you will treasure for many years.",
      }),
    );

    const result = runDispatch(
      "post-edit",
      { tool_input: { file_path: filePath } },
      { JVTO_EKOSYSTEM_ROOT: repoDir },
    );

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.match(parsed.hookSpecificOutput.additionalContext, /fewer than three|Fluff adjective/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("post-edit against a missing ekosistem repo produces no output and does not warn", () => {
  const missingDir = path.join(tmpdir(), "jvto-ops-test-dispatch-missing-post-edit-4712");
  const filePath = path.join(
    missingDir,
    "1-knowledge-and-evidence-core",
    "destination-knowledge",
    "x.content.json",
  );
  const result = runDispatch(
    "post-edit",
    { tool_input: { file_path: filePath } },
    { JVTO_EKOSYSTEM_ROOT: missingDir },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "");
});

// Regression test for the defect the fix wave itself introduced: every
// checker used to end with process.exit(report(...)). console.log() to a
// piped stdout is an async write, and process.exit() tears the process
// down before Node finishes flushing it — so a --json payload big enough
// to outrun the OS pipe buffer got silently truncated. hook-dispatch.mjs
// JSON.parses that (now-truncated) stdout over spawnSync, the parse threw,
// and the catch swallowed it into `{ findings: [], skipped: false }` — a
// checker with 400 genuine graph-integrity errors produced no deny at all.
// Every other fixture in this file is a single finding, comfortably under
// any pipe buffer — which is exactly why nothing caught this. This one
// builds a fixture large enough that the checker's own --json output
// exceeds 64KB, so the regression can't silently return here either.
test("pre-push against a repo with hundreds of dangling references still denies, with findings intact, once --json output exceeds 64KB", () => {
  const repoDir = mkdtempSync(path.join(tmpdir(), "jvto-ops-test-dispatch-huge-"));
  try {
    const pagesDir = path.join(repoDir, "5-experience-engine", "json-ld", "pages");
    mkdirSync(pagesDir, { recursive: true });

    const DANGLING_COUNT = 400;
    const nodes = [];
    for (let i = 0; i < DANGLING_COUNT; i++) {
      nodes.push({
        "@id": `https://javavolcano-touroperator.com/#org-${i}`,
        "@type": "Organization",
        name: `X${i}`,
        publisher: { "@id": `https://javavolcano-touroperator.com/#missing-${i}` },
      });
    }
    writeFileSync(
      path.join(pagesDir, "x.schema-output.json"),
      JSON.stringify({ json_ld: { "@graph": nodes } }),
    );

    // Confirm the premise directly against the checker first: its own
    // --json output must actually cross the 64KB pipe-buffer threshold,
    // or this test would pass for the wrong reason (a fixture too small
    // to ever have tripped the truncation bug in the first place).
    const CHECKER_PATH = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "scripts",
      "check-graph-integrity.mjs",
    );
    const direct = spawnSync(process.execPath, [CHECKER_PATH, "--json"], {
      encoding: "utf8",
      env: { ...process.env, JVTO_EKOSYSTEM_ROOT: repoDir },
    });
    assert.ok(
      Buffer.byteLength(direct.stdout, "utf8") > 65536,
      `fixture's --json output must exceed the 64KB pipe buffer (was ${Buffer.byteLength(direct.stdout, "utf8")} bytes)`,
    );

    const result = runDispatch(
      "pre-push",
      { tool_input: { command: "git push origin main" } },
      { JVTO_EKOSYSTEM_ROOT: repoDir },
    );

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
    const reason = parsed.hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /never defined/);
    // All 400 findings survived, not just however many fit before the old
    // truncation point.
    const mentions = reason.match(/never defined/g) ?? [];
    assert.equal(mentions.length, DANGLING_COUNT);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

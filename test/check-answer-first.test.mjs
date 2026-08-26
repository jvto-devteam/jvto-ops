import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAnswerFirst } from "../scripts/check-answer-first.mjs";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/answer-first/${name}.source.json`, import.meta.url)))
    .meta.answerFirst;

test("a compliant block produces no findings", () => {
  assert.deepEqual(checkAnswerFirst(load("good"), "good.source.json"), []);
});

test("a 27-word block is flagged as too short", () => {
  const messages = checkAnswerFirst(load("short"), "short.source.json").map((f) => f.message);
  assert.ok(messages.some((m) => /27 words/.test(m) && /40-60/.test(m)));
});

test("literal volatile numbers are flagged with the token that replaces them", () => {
  const messages = checkAnswerFirst(load("literal-numbers"), "x.source.json").map((f) => f.message);
  assert.ok(messages.some((m) => m.includes("{GOOGLE_REVIEW_COUNT}")));
  assert.ok(messages.some((m) => m.includes("{PRICE_FROM}")));
  // The "private itineraries" rule deliberately never names {PACKAGE_COUNT}:
  // that token is the catalogue-wide total, but this rule also fires on a
  // per-origin count (a different, smaller number), so the message flags
  // the literal without prescribing a token that might not fit.
  assert.ok(
    messages.some((m) => /private itineraries/.test(m) && !m.includes("{PACKAGE_COUNT}")),
  );
});

test("fluff adjectives are named individually", () => {
  const messages = checkAnswerFirst(load("fluffy"), "x.source.json").map((f) => f.message);
  assert.ok(messages.some((m) => m.includes("breathtaking")));
  assert.ok(messages.some((m) => m.includes("unforgettable")));
});

test("a fact-poor block is flagged for fewer than three facts, as a warning not an error", () => {
  const findings = checkAnswerFirst(load("fluffy"), "x.source.json");
  const factFinding = findings.find((f) => /fewer than three/.test(f.message));
  assert.ok(factFinding);
  assert.equal(factFinding.level, "warn");
});

test("word counting ignores markdown and punctuation noise", () => {
  const text = Array.from({ length: 45 }, (_, i) => `word${i}`).join(" ");
  const messages = checkAnswerFirst(text, "x.source.json").map((f) => f.message);
  assert.ok(!messages.some((m) => /words/.test(m) && /40-60/.test(m)));
});

// Carried-forward fix: FACT_PATTERNS' bare-currency pattern matches "IDR 10"
// (its trailing [A-Za-z]* matches zero letters before the next space) while
// the magnitude-word pattern separately matches the longer "IDR 10 million"
// starting at the same position — one written number used to satisfy
// two-thirds of the three-fact gate by itself. This block has exactly one
// other quantified fact (BBKSDA) beside "IDR 10 million", so a correct
// (deduped) count is 2 -- still fewer than three -- while the pre-fix
// double count would have reached 3 and produced no finding at all.
test("IDR 10 million counts as one fact, not two, via the currency/magnitude overlap", () => {
  const text =
    "The estimated rehabilitation budget for this stretch of forest is IDR 10 million, according to BBKSDA officials who inspected the site last week during the dry season.";
  const findings = checkAnswerFirst(text, "x.source.json");
  const factFinding = findings.find((f) => /fewer than three/.test(f.message));
  assert.ok(factFinding, "expected a fewer-than-three-facts finding; the overlap was not deduped");
  assert.ok(/Only 2 quantified/.test(factFinding.message));
});

// CLI-level tests: a missing sibling repo must degrade to a quiet skip
// (exit 0), never a crash, and an unrecognised flag must be rejected rather
// than silently treated as a file path.
const SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "check-answer-first.mjs",
);

test("a missing ekosistem repo exits 0 with a skip notice, not a crash", () => {
  const missingDir = path.join(tmpdir(), "jvto-ops-test-definitely-missing-repo-9001");
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    encoding: "utf8",
    env: { ...process.env, JVTO_EKOSYSTEM_ROOT: missingDir },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped/);
});

test("an unrecognised flag is rejected rather than silently treated as a file path", () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--not-a-real-flag"], {
    encoding: "utf8",
    env: { ...process.env, JVTO_EKOSYSTEM_ROOT: tmpdir() },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown flag/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("a fact-poor block is flagged for fewer than three facts", () => {
  const messages = checkAnswerFirst(load("fluffy"), "x.source.json").map((f) => f.message);
  assert.ok(messages.some((m) => /fewer than three/.test(m)));
});

test("word counting ignores markdown and punctuation noise", () => {
  const text = Array.from({ length: 45 }, (_, i) => `word${i}`).join(" ");
  const messages = checkAnswerFirst(text, "x.source.json").map((f) => f.message);
  assert.ok(!messages.some((m) => /words/.test(m) && /40-60/.test(m)));
});

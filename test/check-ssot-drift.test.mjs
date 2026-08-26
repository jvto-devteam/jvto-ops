import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAssembledContent } from "../scripts/check-ssot-drift.mjs";

const read = (name) =>
  readFileSync(new URL(`./fixtures/drift/${name}.tsx`, import.meta.url), "utf8");

// Acceptance table (task-4 fix round 3):
//
// | shape                                       | expected |
// |----------------------------------------------|----------|
// | lone backtick literal, no ${}                 | no finding |
// | plain quoted string, any length               | no finding |
// | concatenation of literals only                | no finding |
// | X ?? <literal> in any form                    | no finding |
// | template literal containing ${}               | finding    |
// | concatenation splicing a non-literal          | finding    |

test("lone backtick literal with no ${} interpolation is not reported", () => {
  assert.deepEqual(checkAssembledContent(read("plain-template-no-interpolation"), "note.tsx"), []);
});

test("plain quoted string, any length, is not reported", () => {
  assert.deepEqual(checkAssembledContent(read("plain-string-any-length"), "page.tsx"), []);
});

test("concatenation of literals only is not reported", () => {
  assert.deepEqual(checkAssembledContent(read("concat-literals-only"), "page.tsx"), []);
});

test("X ?? <literal> is not reported, whatever form X takes", () => {
  assert.deepEqual(checkAssembledContent(read("nullish-fallback-any-form"), "page.tsx"), []);
});

test("reading from ekosistem with a ?? fallback is not reported", () => {
  assert.deepEqual(checkAssembledContent(read("clean"), "page.tsx"), []);
});

test("a template literal containing ${} is reported", () => {
  const findings = checkAssembledContent(read("assembled"), "page.tsx");
  assert.equal(findings.length >= 1, true);
  assert.ok(findings[0].message.includes("answerFirst"));
  assert.equal(findings[0].level, "error");
});

test("concatenation splicing a computed (non-literal) value is reported", () => {
  const findings = checkAssembledContent(read("spliced-computed"), "page.tsx");
  assert.equal(findings.length >= 1, true);
  assert.ok(findings[0].message.includes("answerFirst"));
  assert.equal(findings[0].level, "error");
});

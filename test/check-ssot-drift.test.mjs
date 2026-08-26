import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAssembledContent } from "../scripts/check-ssot-drift.mjs";

const read = (name) =>
  readFileSync(new URL(`./fixtures/drift/${name}.tsx`, import.meta.url), "utf8");

test("prose assembled from a template literal is reported", () => {
  const findings = checkAssembledContent(read("assembled"), "page.tsx");
  assert.equal(findings.length >= 1, true);
  assert.ok(findings[0].message.includes("answerFirst"));
  assert.equal(findings[0].level, "error");
});

test("reading from ekosistem with a fallback is not reported", () => {
  assert.deepEqual(checkAssembledContent(read("clean"), "page.tsx"), []);
});

test("a plain string constant is never reported, regardless of length or how it's consumed", () => {
  assert.deepEqual(checkAssembledContent(read("plain-string-any-length"), "page.tsx"), []);
});

test("a lone template literal with no ${} interpolation is not reported", () => {
  assert.deepEqual(checkAssembledContent(read("plain-template-no-interpolation"), "note.tsx"), []);
});

test("concatenation splicing a computed value into prose is reported", () => {
  const findings = checkAssembledContent(read("spliced-computed"), "page.tsx");
  assert.equal(findings.length >= 1, true);
  assert.ok(findings[0].message.includes("answerFirst"));
  assert.equal(findings[0].level, "error");
});

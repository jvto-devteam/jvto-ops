import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRouteResolution, pageFileForRoute } from "../scripts/check-live-tokens.mjs";

const read = (name) =>
  readFileSync(new URL(`./fixtures/live-tokens/${name}.tsx`, import.meta.url), "utf8");

// The defect this checker was written for: /tours/from-surabaya printed
// "{PACKAGE_COUNT_SURABAYA}" to readers because the page read the field and
// rendered it without resolving. check-answer-first called the route clean
// throughout — it reads the source, where the token is correct by design.
test("flags a page that renders a token without resolving it", () => {
  const out = checkRouteResolution(
    "/tours/from-surabaya",
    ["{PACKAGE_COUNT_SURABAYA}"],
    read("leaking"),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].level, "warn");
  assert.match(out[0].message, /literal text/);
  assert.deepEqual(out[0].tokens, ["{PACKAGE_COUNT_SURABAYA}"]);
});

test("accepts a page that calls applyLiveNumbers", () => {
  assert.deepEqual(
    checkRouteResolution("/tours", ["{PACKAGE_COUNT}", "{PRICE_FROM}"], read("resolved")),
    [],
  );
});

// The checker's own first-run false positive: /verify-jvto resolves
// {PACKAGE_COUNT} by hand, and the live page was already printing 17 when this
// was reported as a leak. It must not claim a leak — but it is still worth a
// word, because the hand-rolled replace only covers the token it names.
test("does not call a hand-rolled resolve a leak, but still reports it", () => {
  const out = checkRouteResolution("/verify-jvto", ["{PACKAGE_COUNT}"], read("hand-rolled"));
  assert.equal(out.length, 1);
  assert.equal(out[0].level, "warn");
  assert.doesNotMatch(out[0].message, /literal text/);
  assert.match(out[0].message, /by hand/);
});

test("a hand-rolled resolve still leaks a token it does not name", () => {
  const out = checkRouteResolution(
    "/verify-jvto",
    ["{PACKAGE_COUNT}", "{GOOGLE_RATING}"],
    read("hand-rolled"),
  );
  assert.equal(out.length, 1);
  assert.match(out[0].message, /literal text/);
  assert.deepEqual(out[0].tokens, ["{GOOGLE_RATING}"], "only the unnamed token is unresolved");
});

test("a route with no tokens is never reported", () => {
  assert.deepEqual(checkRouteResolution("/contact", [], read("leaking")), []);
});

// A route served by a [slug] segment has no page.tsx of its own. The checker
// resolves nothing there and must stay silent rather than guess which dynamic
// segment renders it.
test("an unresolvable route file is not reported", () => {
  assert.deepEqual(checkRouteResolution("/blog/some-post", ["{PACKAGE_COUNT}"], null), []);
});

test("pageFileForRoute returns null for a route with no static page", () => {
  assert.equal(pageFileForRoute("/definitely/not/a/route", "/tmp/nonexistent-web"), null);
});

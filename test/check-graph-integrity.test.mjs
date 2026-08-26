import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collectGraph,
  checkGraph,
  loadConsumerDefinedIds,
  consumerExemptionDocs,
} from "../scripts/check-graph-integrity.mjs";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/graph/${name}.json`, import.meta.url)));

const fixturePath = (name) => new URL(`./fixtures/graph/${name}`, import.meta.url);

test("a graph whose references all resolve produces no findings", () => {
  assert.deepEqual(checkGraph(collectGraph([load("clean")])), []);
});

test("a dangling reference is reported with the predicate that carries it", () => {
  const findings = checkGraph(collectGraph([load("dangling")]));
  const dangling = findings.filter((f) => /never defined/.test(f.message));
  assert.equal(dangling.length, 1);
  assert.ok(dangling[0].message.includes("#org-dumont-reiseverlag"));
  assert.ok(dangling[0].message.includes("publisher"));
  assert.equal(dangling[0].level, "error");
});

test("a bare url value is not mistaken for a node reference", () => {
  const findings = checkGraph(collectGraph([load("dangling")]));
  assert.ok(!findings.some((f) => f.message.includes("only-a-url")));
});

test("an inline node duplicating a registry entry by name is reported", () => {
  const findings = checkGraph(collectGraph([load("inline-duplicate")]));
  const dupes = findings.filter((f) => /inline/.test(f.message));
  assert.equal(dupes.length, 1);
  assert.ok(dupes[0].message.includes("#org-polpar-bondowoso"));
});

test("a node defined on one document and referenced from another resolves", () => {
  const a = { "@graph": [{ "@id": "https://x.test/#a", "@type": "Thing", "name": "A" }] };
  const b = { "@graph": [{ "@id": "https://x.test/#b", "@type": "Thing", "about": { "@id": "https://x.test/#a" } }] };
  assert.deepEqual(checkGraph(collectGraph([a, b])), []);
});

// Pins the cross-repo seam: an id jvto-web builds and merges at render time
// (per test/fixtures/graph/consumer-defined-ids.fixture.json, not the real
// scripts/consumer-defined-ids.json) must not be reported in the default
// (offline) scan, because consumerExemptionDocs() seeds it as defined — but
// the exact same graph, checked without that seeding (as --live does, since
// there the fetched graph is already fully merged), must still report it.
test("a consumer-defined id is exempt in the default scan but dangling without the exemption", () => {
  const config = loadConsumerDefinedIds(fixturePath("consumer-defined-ids.fixture.json"));
  const doc = {
    "@graph": [
      {
        "@id": "https://x.test/#org",
        "@type": "Organization",
        "name": "X",
        "founder": { "@id": "https://x.test/#consumer-built-founder" },
      },
    ],
  };

  const liveFindings = checkGraph(collectGraph([doc]));
  const dangling = liveFindings.filter((f) => /never defined/.test(f.message));
  assert.equal(dangling.length, 1);
  assert.ok(dangling[0].message.includes("#consumer-built-founder"));

  const offlineFindings = checkGraph(collectGraph([doc, ...consumerExemptionDocs(config)]));
  assert.ok(!offlineFindings.some((f) => f.message.includes("#consumer-built-founder")));
});

test("loadConsumerDefinedIds degrades to no exemptions when the file is missing", () => {
  const config = loadConsumerDefinedIds(fixturePath("does-not-exist.json"));
  assert.deepEqual(config, { ids: [] });
  assert.deepEqual(consumerExemptionDocs(config), []);
});

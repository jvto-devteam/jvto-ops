import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collectGraph,
  checkGraph,
  loadConsumerDefinedIds,
  consumerExemptionDocs,
  resolveScanInputs,
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

// Pins the cross-repo seam end to end, through resolveScanInputs() — the
// exact seam main() calls, not just the primitives underneath it. A refactor
// that moved the exemption-seeding line out of the offline branch, or that
// leaked it into the live branch, would show up here even though it would
// pass every test that only calls checkGraph()/consumerExemptionDocs()
// directly.
const CONSUMER_FIXTURE = loadConsumerDefinedIds(fixturePath("consumer-defined-ids.fixture.json"));

test("resolveScanInputs seeds the literal-id exemption offline, not live", () => {
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

  const offline = resolveScanInputs({ live: false, docs: [doc], exemptions: CONSUMER_FIXTURE });
  const offlineFindings = checkGraph(collectGraph(offline.docs), { exemptPatterns: offline.exemptPatterns });
  assert.ok(!offlineFindings.some((f) => f.message.includes("#consumer-built-founder")));

  const live = resolveScanInputs({ live: true, docs: [doc], exemptions: CONSUMER_FIXTURE });
  const liveFindings = checkGraph(collectGraph(live.docs), { exemptPatterns: live.exemptPatterns });
  const dangling = liveFindings.filter((f) => /never defined/.test(f.message));
  assert.equal(dangling.length, 1);
  assert.ok(dangling[0].message.includes("#consumer-built-founder"));
});

// The pattern class (the tour-PDP #webpage ids) exists specifically because
// a per-route id list rots: every package added or removed in ekosistem
// would need a matching edit in this plugin, and the first missed edit
// falsely blocks a correct push. onlyUnderPredicates keeps the pattern from
// being a hole: the same id under a different predicate is still checked.
test("resolveScanInputs' pattern exemption is scoped to onlyUnderPredicates, and only offline", () => {
  const matchingId = "https://x.test/tours/ijen-bromo-3d2n#webpage";

  const scopedDoc = {
    "@graph": [
      {
        "@id": "https://x.test/tours/ijen-bromo-3d2n#tour",
        "@type": "TouristTrip",
        "name": "Tour",
        "mainEntityOfPage": { "@id": matchingId },
      },
    ],
  };
  const offlineScoped = resolveScanInputs({ live: false, docs: [scopedDoc], exemptions: CONSUMER_FIXTURE });
  const offlineScopedFindings = checkGraph(collectGraph(offlineScoped.docs), {
    exemptPatterns: offlineScoped.exemptPatterns,
  });
  assert.ok(!offlineScopedFindings.some((f) => f.message.includes(matchingId)));

  // Same id, different predicate — the pattern must not swallow this one.
  const wrongPredicateDoc = {
    "@graph": [
      {
        "@id": "https://x.test/tours/ijen-bromo-3d2n#tour",
        "@type": "TouristTrip",
        "name": "Tour",
        "about": { "@id": matchingId },
      },
    ],
  };
  const offlineWrongPred = resolveScanInputs({ live: false, docs: [wrongPredicateDoc], exemptions: CONSUMER_FIXTURE });
  const offlineWrongPredFindings = checkGraph(collectGraph(offlineWrongPred.docs), {
    exemptPatterns: offlineWrongPred.exemptPatterns,
  });
  assert.ok(offlineWrongPredFindings.some((f) => f.message.includes(matchingId) && /never defined/.test(f.message)));

  // Same id, right predicate, but live — the pattern must not apply there
  // either, since the fetched graph is already the full merge.
  const live = resolveScanInputs({ live: true, docs: [scopedDoc], exemptions: CONSUMER_FIXTURE });
  const liveFindings = checkGraph(collectGraph(live.docs), { exemptPatterns: live.exemptPatterns });
  assert.ok(liveFindings.some((f) => f.message.includes(matchingId) && /never defined/.test(f.message)));
});

test("loadConsumerDefinedIds degrades to no exemptions when the file is missing", () => {
  const config = loadConsumerDefinedIds(fixturePath("does-not-exist.json"));
  assert.deepEqual(config, { ids: [], patterns: [] });
  assert.deepEqual(consumerExemptionDocs(config), []);
  assert.deepEqual(resolveScanInputs({ live: false, docs: [], exemptions: config }), {
    docs: [],
    exemptPatterns: [],
  });
});

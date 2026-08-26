// Entity-graph integrity: dangling @id references and inline duplicate nodes.
//
// This is the only checker cleared to block a `git push`, so its
// false-positive rate has to be zero. Two exemptions earn that:
//
//   1. VALUE_PREDICATES — predicates whose values are URLs, not node
//      references (url, sameAs, image, logo, contentUrl, thumbnailUrl,
//      identifier). Edges under these keys are never treated as references,
//      full stop — their value subtree isn't even walked for nested @id
//      nodes, since a PropertyValue or ImageObject nested under `identifier`
//      is not part of the entity graph this checker polices.
//   2. Cross-document resolution — a node defined in one document and
//      referenced from another must resolve. The entity registry (e.g.
//      Organization/GovernmentOrganization nodes shared across many pages)
//      is designed that way; treating it as dangling would block every push.
//
// A third thing looks like a dangling reference but isn't one: the graph
// this checker sees offline is only HALF a graph. jvto-web builds some nodes
// (the founder's Person node, each tour PDP's own WebPage node) and merges
// them into the same combined @graph at render time — jvto-ekosistem never
// emits them itself by design (see jvto-ekosistem/scripts/validate-schema.mjs,
// which carries the identical exemption for the identical reason). Reading
// the ekosistem half in isolation makes those edges look dangling. That's
// not a URL-value predicate and not cross-document resolution — it's a
// cross-REPO seam — so it gets its own mechanism: scripts/consumer-defined-ids.json
// lists exactly which ids jvto-web builds and merges, reviewably, and the
// CLI wrapper seeds them into the graph as synthetic definitions — but only
// for the offline scan. In --live mode the full merged graph is visible, so
// a genuinely dangling id (including a mistyped one of these) still fails.
//
// Pure logic lives in collectGraph()/checkGraph() so tests can call them
// directly with parsed JSON-LD, no I/O. The CLI wrapper below reads the
// offline *.schema-output.json corpus by default, or (with --live) fetches
// the site's sitemap and extracts <script type="application/ld+json"> blocks.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finding, report, ekosystemRoot, webRoot, requireRepo, rootOverride } from "./lib/repos.mjs";

export const VALUE_PREDICATES = new Set([
  "url",
  "sameAs",
  "image",
  "logo",
  "contentUrl",
  "thumbnailUrl",
  "identifier",
]);

// Ids under these prefixes are the ones this repo's entity graph controls.
// Anything else (a third-party domain used as an @id, which happens with
// sameAs-style identifiers on external profiles) is an external URL, not a
// registry node, and is never a candidate for "never defined".
const OWNED_ID_PREFIXES = ["https://javavolcano-touroperator.com", "https://x.test"];

function isOwnedId(id) {
  return OWNED_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Walks every document depth-first, collecting:
 *   - defined: ids that carry an @id plus at least one other key, anywhere
 *     across all documents (cross-document resolution).
 *   - edges: { src, pred, dst } for every nested object with an @id, from
 *     the nearest enclosing @id. Values under VALUE_PREDICATES are skipped
 *     entirely — not walked, not turned into edges.
 *   - typesById: @id -> Set of @type values seen for that id.
 *
 * Also collects two extras used only by checkGraph (not part of the
 * documented three-field contract, but harmless to carry alongside it):
 *   - namesById: @id -> normalized `name` string, for defined nodes.
 *   - inlineNamed: [{ name, normalizedName }] for objects with no @id, a
 *     @type, and a `name` string — candidates for the inline-duplicate check.
 */
export function collectGraph(docs) {
  const defined = new Set();
  const edges = [];
  const typesById = new Map();
  const namesById = new Map();
  const inlineNamed = [];

  function recordType(id, node) {
    const rawType = node["@type"];
    if (!rawType) return;
    const types = Array.isArray(rawType) ? rawType : [rawType];
    if (!typesById.has(id)) typesById.set(id, new Set());
    const set = typesById.get(id);
    for (const t of types) set.add(t);
  }

  function walkProperties(node, srcId) {
    for (const [pred, value] of Object.entries(node)) {
      if (pred === "@id" || pred === "@type") continue;
      if (VALUE_PREDICATES.has(pred)) continue; // skipped entirely
      walkValue(value, pred, srcId);
    }
  }

  function walkValue(value, pred, srcId) {
    if (Array.isArray(value)) {
      for (const item of value) walkValue(item, pred, srcId);
      return;
    }
    if (!isPlainObject(value)) return;

    const id = value["@id"];
    if (typeof id === "string") {
      if (srcId && pred) {
        edges.push({ src: srcId, pred, dst: id });
      }
      const hasOtherKeys = Object.keys(value).some((k) => k !== "@id");
      if (hasOtherKeys) {
        defined.add(id);
        recordType(id, value);
        if (typeof value.name === "string") {
          namesById.set(id, normalizeName(value.name));
        }
      }
      walkProperties(value, id);
      return;
    }

    // Object with no @id: a candidate inline node, and still worth walking
    // for nested references (using the same enclosing srcId, since this
    // object doesn't introduce a new one).
    if (typeof value["@type"] !== "undefined" && typeof value.name === "string") {
      inlineNamed.push({ name: value.name, normalizedName: normalizeName(value.name) });
    }
    walkProperties(value, srcId);
  }

  for (const doc of docs) {
    if (isPlainObject(doc)) walkValue(doc, null, null);
  }

  return { defined, edges, typesById, namesById, inlineNamed };
}

/**
 * Checks a collected graph for the two error classes this checker exists
 * for. Pure — takes the object collectGraph() returns, does no I/O.
 */
export function checkGraph(graph) {
  const { defined, edges, namesById, inlineNamed } = graph;
  const findings = [];

  const predsByDst = new Map();
  for (const { pred, dst } of edges) {
    if (defined.has(dst)) continue;
    if (!isOwnedId(dst)) continue; // external URL, not a registry node
    if (!predsByDst.has(dst)) predsByDst.set(dst, new Set());
    predsByDst.get(dst).add(pred);
  }
  for (const [dst, preds] of predsByDst) {
    const predList = [...preds].sort().join(", ");
    findings.push(
      finding("error", "entity-graph", `\`${dst}\` is referenced by ${predList} but never defined`),
    );
  }

  for (const { normalizedName } of inlineNamed) {
    for (const [id, name] of namesById) {
      if (name === normalizedName) {
        findings.push(
          finding(
            "error",
            "entity-graph",
            `inline node duplicates \`${id}\`; reference it by @id instead`,
          ),
        );
        break;
      }
    }
  }

  return findings;
}

/**
 * Reads scripts/consumer-defined-ids.json: a reviewable list of @id values
 * that jvto-web builds at render time and merges into the same combined
 * @graph, which the offline scan — reading only the ekosistem half — would
 * otherwise report as dangling. Returns { ids: [...] }, or { ids: [] } if
 * the file is missing or malformed, so a missing file degrades to "no
 * consumer exemptions" rather than crashing the checker.
 */
export function loadConsumerDefinedIds(filePath) {
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    return { ids: Array.isArray(data.ids) ? data.ids : [] };
  } catch {
    return { ids: [] };
  }
}

/**
 * Turns a consumer-defined-ids config into synthetic documents that make
 * each listed id "defined" via the exact same has-@id-plus-another-key rule
 * collectGraph already uses for everything else — no special-casing inside
 * collectGraph/checkGraph, and so no risk to the two exemptions that make
 * this checker safe to block on. Pure — takes the parsed config, does no
 * I/O — so tests can exercise it with a fixture instead of the real file.
 */
export function consumerExemptionDocs(config) {
  const ids = (config.ids ?? []).map((entry) => entry.id).filter((id) => typeof id === "string");
  if (ids.length === 0) return [];
  return [{ "@graph": ids.map((id) => ({ "@id": id, "@type": "Thing" })) }];
}

function findSchemaOutputFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .filter((entry) => entry.endsWith(".schema-output.json"))
    .map((entry) => path.join(dir, entry));
}

function loadOfflineDocs(root) {
  const dir = path.join(root, "5-experience-engine", "json-ld", "pages");
  const docs = [];
  for (const file of findSchemaOutputFiles(dir)) {
    let data;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (data && typeof data === "object" && data.json_ld) {
      docs.push(data.json_ld);
    }
  }
  return docs;
}

function extractLdJsonBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      // Malformed JSON-LD is not this checker's problem; skip it.
    }
  }
  return blocks;
}

function extractSitemapRoutes(xml) {
  const routes = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let match;
  while ((match = re.exec(xml)) !== null) {
    routes.push(match[1].trim());
  }
  return routes;
}

async function loadLiveDocs(web) {
  const sitemapPath = path.join(web, "public", "sitemap.xml");
  const xml = readFileSync(sitemapPath, "utf8");
  const routes = extractSitemapRoutes(xml);
  const docs = [];
  for (const route of routes) {
    const res = await fetch(route);
    if (!res.ok) continue;
    const html = await res.text();
    docs.push(...extractLdJsonBlocks(html));
  }
  return docs;
}

const CONSUMER_DEFINED_IDS_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "consumer-defined-ids.json",
);

async function main() {
  const argv = process.argv.slice(2);
  const override = rootOverride(argv);
  const live = argv.includes("--live");

  let docs;
  if (live) {
    const web = requireRepo("web", webRoot(override));
    docs = await loadLiveDocs(web);
    // No consumer-defined-ids seeding here: the live fetch already returns
    // the fully merged graph (ekosistem + jvto-web), so a genuinely
    // dangling id — including a mistyped one of the ids in that file —
    // must still fail.
  } else {
    const root = ekosystemRoot(override);
    requireRepo("ekosistem", root);
    docs = loadOfflineDocs(root);
    const consumerConfig = loadConsumerDefinedIds(CONSUMER_DEFINED_IDS_PATH);
    docs.push(...consumerExemptionDocs(consumerConfig));
  }

  const graph = collectGraph(docs);
  const findings = checkGraph(graph);

  process.exit(report("check-graph-integrity", findings, argv));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

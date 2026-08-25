// Catches the four mechanical failures of an answer-first block:
//   1. Word count outside the 40-60 range.
//   2. Fewer than three quantified, distinct facts.
//   3. A fluff-blacklist adjective standing alone (warning, never an error —
//      one adjective beside a real number is defensible, and a checker that
//      blocks on taste gets muted).
//   4. A volatile number written as a literal where a stable token exists.
//
// Pure logic lives in checkAnswerFirst() so tests can call it directly with
// no I/O. The CLI wrapper below walks the ekosistem repo, or checks only the
// explicit file paths given on the command line.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { finding, report, ekosystemRoot, requireRepo, rootOverride } from "./lib/repos.mjs";

export const WORD_MIN = 40;
export const WORD_MAX = 60;

const AUTHORITIES = [
  "BBKSDA",
  "Ditlantas",
  "POLRI",
  "Polres",
  "HPWKI",
  "DPMPTSP",
  "Kemenkumham",
  "Kemenparekraf",
  "Kemenkes",
  "BKPM",
  "Paltuding",
  "Tengger",
  "Bondowoso",
  "Banyuwangi",
];

const FLUFF = [
  "amazing",
  "unforgettable",
  "magical",
  "hidden paradise",
  "once-in-a-lifetime",
  "once in a lifetime",
  "breathtaking",
  "stunning",
  "the best",
  "most trusted",
  "number one",
  "world-class",
  "excellent service",
  "professional team",
  "competitive price",
  "truly unique",
  "must-see",
];

const VOLATILE_LITERALS = [
  { re: /\b\d{2,4}\s+Google reviews\b/gi, token: "{GOOGLE_REVIEW_COUNT}" },
  { re: /\b\d\.\d\s*\/\s*5\b/g, token: "{GOOGLE_RATING}" },
  { re: /\bIDR\s*[\d.]+\s*M\/pax\b/gi, token: "{PRICE_FROM}" },
  {
    // Deliberately no `token` here. {PACKAGE_COUNT} is the catalogue-wide
    // total, but this pattern also fires on a per-origin count (e.g. "13
    // private itineraries from Surabaya"), which is a different, smaller
    // number. Naming {PACKAGE_COUNT} unconditionally would tell an author to
    // publish the wrong figure, so the message names the problem and asks
    // for a live token without prescribing which one.
    re: /\b\d{1,3}\s+private itineraries\b/gi,
    message: (match) =>
      `Volatile number "${match}" is written as a literal — this count moves as packages are added or removed and needs a live token, but the catalogue-wide total is a different number: do not assume it fits here.`,
  },
];

function escapeRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Spelled-out cardinals one through twenty. Counted as a fact only when they
// immediately precede another word (a noun) — "three explainers" is the same
// quantified claim as "3 explainers"; "one" standing alone, or followed by a
// stopword that signals it isn't modifying a noun (e.g. "one of", "10
// million" already covered by the currency pattern), is not.
const CARDINAL_WORDS = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty",
];
const CARDINAL_STOPWORDS = new Set([
  "of", "is", "are", "was", "were", "the", "a", "an", "that", "which", "who",
  "more", "less", "than", "hundred", "thousand", "million", "billion", "or",
  "and", "to", "in", "on", "at", "for", "from", "with", "percent",
]);
const CARDINAL_RE = new RegExp(
  `\\b(?:${CARDINAL_WORDS.join("|")})\\s+([a-z]+)\\b`,
  "gi",
);

const FACT_PATTERNS = [
  // A number with a unit: m, km, kg, mdpl, minutes/hours/days/nights, pax, %, IDR, Rp.
  // Trailing lookahead (not \b) because "%" isn't a word character, so a
  // word boundary assertion right after it never fires.
  /\b\d[\d,.]*\s*(?:m|km|kg|mdpl|minutes?|hours?|days?|nights?|pax|%)(?![A-Za-z])/gi,
  // Unit-first currency, number attached directly to the unit (IDR 1.55M).
  /\b(?:IDR|Rp)\s*[\d,.]+[A-Za-z]*\b/gi,
  // Unit-first currency with a spelled-out magnitude word (IDR 10 million,
  // Rp 50 juta) — still "a number with a unit," just unit-first with the
  // number and unit separated by the magnitude word instead of touching.
  /\b(?:IDR|Rp)\s*[\d,.]+\s+(?:million|billion|juta|miliar)\b/gi,
  // ISO date.
  /\b\d{4}-\d{2}-\d{2}\b/g,
  // Month YYYY.
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/g,
  // A document number: SE, AHU, SPRIN, NIB, TDUP, NPWP, STR, SIP, KTA followed by a code.
  /\b(?:SE|AHU|SPRIN|NIB|TDUP|NPWP|STR|SIP|KTA)[.\-\s][A-Z0-9./-]{3,}/g,
  // A run of 9+ digits.
  /\d{9,}/g,
  // A named authority.
  new RegExp(`\\b(?:${AUTHORITIES.map(escapeRegex).join("|")})\\b`, "g"),
  // A volatile-number token (e.g. {GOOGLE_RATING}, {PACKAGE_COUNT}) counts as
  // a quantified fact too — it is a stable stand-in for a real number that
  // changes over time. Otherwise correctly tokenizing a volatile number
  // (rule 4) would make a block fail the fact-count check (rule 2), which
  // would punish exactly the fix rule 4 requires.
  /\{[A-Z][A-Z0-9_]*\}/g,
];

function countWords(text) {
  // Strip markdown link syntax ([text](url) -> text) before splitting, so
  // link markup doesn't distort the count either way.
  const stripped = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  return stripped
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function countDistinctFacts(text) {
  const matches = new Set();
  for (const pattern of FACT_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      matches.add(m[0]);
    }
  }
  for (const m of text.matchAll(CARDINAL_RE)) {
    if (!CARDINAL_STOPWORDS.has(m[1].toLowerCase())) {
      matches.add(m[0]);
    }
  }
  return matches;
}

/**
 * Checks one answer-first block for the four mechanical failures. Pure —
 * takes the block text and the file path to attribute findings to, does no
 * I/O, and returns a Finding[] (possibly empty).
 */
export function checkAnswerFirst(text, filePath) {
  const findings = [];

  const wordCount = countWords(text);
  if (wordCount < WORD_MIN || wordCount > WORD_MAX) {
    findings.push(
      finding("error", filePath, `${wordCount} words, outside the 40-60 range`),
    );
  }

  const facts = countDistinctFacts(text);
  if (facts.size < 3) {
    findings.push(
      finding(
        "error",
        filePath,
        `Only ${facts.size} quantified fact(s) found — fewer than three is not enough for an answer-first block.`,
      ),
    );
  }

  for (const phrase of FLUFF) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "gi");
    for (const m of text.matchAll(re)) {
      findings.push(
        finding(
          "warn",
          filePath,
          `Fluff adjective "${m[0]}" is standing alone — replace with a specific fact, or pair it with one.`,
        ),
      );
    }
  }

  for (const rule of VOLATILE_LITERALS) {
    for (const m of text.matchAll(rule.re)) {
      const message = rule.token
        ? `Volatile number "${m[0]}" is written as a literal — replace with the token ${rule.token}.`
        : rule.message(m[0]);
      findings.push(finding("error", filePath, message));
    }
  }

  return findings;
}

function findFiles(dir, suffix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .filter((entry) => entry.endsWith(suffix))
    .map((entry) => path.join(dir, entry));
}

function extractAnswerFirst(filePath) {
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  const text = filePath.endsWith(".content.json")
    ? data?.answerFirst
    : data?.meta?.answerFirst;
  return typeof text === "string" && text.length > 0 ? text : null;
}

function collectTargetFiles(root, explicitPaths) {
  if (explicitPaths.length > 0) {
    return explicitPaths.map((p) => path.resolve(p));
  }
  const core = path.join(root, "1-knowledge-and-evidence-core");
  return [
    ...findFiles(core, ".source.json"),
    ...findFiles(path.join(core, "destination-knowledge"), ".content.json"),
  ];
}

function main() {
  const argv = process.argv.slice(2);
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo-root") {
      i++; // consume its value
      continue;
    }
    if (arg === "--json") continue;
    positionals.push(arg);
  }

  const root = ekosystemRoot(rootOverride(argv));
  requireRepo("ekosistem", root);

  const files = collectTargetFiles(root, positionals);
  const findings = [];
  for (const file of files) {
    const text = extractAnswerFirst(file);
    if (text === null) continue;
    const relPath = path.isAbsolute(file) ? path.relative(root, file) : file;
    findings.push(...checkAnswerFirst(text, relPath));
  }

  process.exit(report("check-answer-first", findings, argv));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

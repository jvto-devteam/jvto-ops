// Catches the four mechanical failures of an answer-first block:
//   1. Word count outside the 40-60 range (error — objective: count the words).
//   2. Fewer than three quantified, distinct facts (warning, not an error —
//      the fact list is a heuristic that has already been widened twice
//      during this build, and it still fires on 22 of 56 live blocks
//      (40% of the corpus). A per-edit hook that blocks on a heuristic
//      firing that often is exactly the muted-checker outcome the
//      checker-hygiene skill exists to prevent; word count and the volatile-
//      literal rule below stay errors because both are objective, not a
//      judgment call about what counts as a fact).
//   3. A fluff-blacklist adjective standing alone (warning, never an error —
//      one adjective beside a real number is defensible, and a checker that
//      blocks on taste gets muted).
//   4. A volatile number written as a literal where a stable token exists
//      (error — objective: the literal is either there or it isn't).
//
// Pure logic lives in checkAnswerFirst() so tests can call it directly with
// no I/O. The CLI wrapper below walks the ekosistem repo, or checks only the
// explicit file paths given on the command line.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { finding, report, ekosystemRoot, requireRepo, rootOverride, runCli } from "./lib/repos.mjs";

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


/**
 * People named in the roster, read from ekosistem rather than guessed.
 *
 * The spec counts "nama orang beratribusi" as a fact, and the implementation
 * had no way to see one: a block naming Agung Sambuko and the Tourist Police
 * scored zero. Detecting capitalised word pairs would have matched half the
 * prose, so the names come from people-and-crew/people.json — the same list
 * the site publishes profiles from. A name nobody on the roster carries is
 * not a fact this checker will credit.
 */
function rosterNames(root) {
  try {
    const people = JSON.parse(
      readFileSync(path.join(root, PEOPLE_PATH), "utf8"),
    );
    const names = new Set();
    for (const person of people.leadership ?? []) {
      if (typeof person.name === "string") names.add(person.name);
    }
    for (const member of people.crew?.roster ?? []) {
      if (typeof member.name === "string") {
        names.add(member.name.replace(/\s*\([^)]*\)\s*/g, " ").trim());
      }
    }
    return [...names].filter((n) => n.length > 2);
  } catch {
    return [];
  }
}

const PEOPLE_PATH = "1-knowledge-and-evidence-core/people-and-crew/people.json";

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
  // A recurring period. The spec's fact list names "tanggal/periode", and a
  // rule like "the first Friday of every month" is exactly that — a date you
  // can plan around, stated as a recurrence rather than a calendar entry.
  // Missing it undercounted the Rijik closure block, whose whole subject is
  // one recurring date.
  /\b(?:first|second|third|fourth|last)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi,
  /\bevery\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|month|week|year|day)\b/gi,
  // A season or month range: April-October, May to October.
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*(?:-|–|to)\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/gi,
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

// Two FACT_PATTERNS entries can both match the same underlying number: the
// bare unit-first currency pattern matches "IDR 10" (its [A-Za-z]* trailer
// matches zero letters when the next character is a space, so it stops
// there), while the magnitude-word pattern separately matches the longer
// "IDR 10 million" starting at the very same "I". Both landed in the
// `matches` Set as different strings, so one written number satisfied
// two-thirds of the three-fact gate by itself. Spans are collected with
// their start/end offsets so a shorter match fully contained inside a longer
// one at the same position — never a coincidence, always the same number
// caught twice — is dropped, keeping only the longest (most specific) match
// for that position. A literal repeat of the exact same fact text elsewhere
// in the block still collapses via the Set, same as before.
function countDistinctFacts(text, names = []) {
  const spans = [];
  for (const pattern of FACT_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  for (const name of names) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "gi");
    for (const m of text.matchAll(re)) {
      spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  for (const m of text.matchAll(CARDINAL_RE)) {
    if (!CARDINAL_STOPWORDS.has(m[1].toLowerCase())) {
      spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }

  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const span of spans) {
    const containedInKept = kept.some((k) => span.start >= k.start && span.end <= k.end);
    if (!containedInKept) kept.push(span);
  }

  return new Set(kept.map((s) => s.text));
}

/**
 * Checks one answer-first block for the four mechanical failures. Pure —
 * takes the block text and the file path to attribute findings to, does no
 * I/O, and returns a Finding[] (possibly empty).
 */
export function checkAnswerFirst(text, filePath, names = []) {
  const findings = [];

  const wordCount = countWords(text);
  if (wordCount < WORD_MIN || wordCount > WORD_MAX) {
    findings.push(
      finding("error", filePath, `${wordCount} words, outside the 40-60 range`),
    );
  }

  const facts = countDistinctFacts(text, names);
  if (facts.size < 3) {
    // Warning, not error — see the file header. This heuristic fires on 22
    // of 56 live blocks (40% of the corpus); a per-edit hook that blocks on
    // that is the muted-checker outcome checker-hygiene exists to prevent.
    findings.push(
      finding(
        "warn",
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
    if (arg.startsWith("--")) {
      // An unrecognised flag used to fall through to `positionals` and get
      // silently treated as a file path (which then just found no
      // answerFirst text and was skipped) — a typo'd flag looked like it
      // ran clean. Reject it instead.
      console.error(`check-answer-first: unknown flag ${arg}`);
      process.exit(1);
    }
    positionals.push(arg);
  }

  const root = ekosystemRoot(rootOverride(argv));
  requireRepo("ekosistem", root);

  const files = collectTargetFiles(root, positionals);
  const names = rosterNames(root);
  const findings = [];
  for (const file of files) {
    const text = extractAnswerFirst(file);
    if (text === null) continue;
    const relPath = path.isAbsolute(file) ? path.relative(root, file) : file;
    findings.push(...checkAnswerFirst(text, relPath, names));
  }

  // process.exitCode, not process.exit(): see check-graph-integrity.mjs for
  // why — process.exit() can truncate a large --json write before
  // hook-dispatch.mjs finishes reading it over spawnSync. (The unknown-flag
  // process.exit(1) above is left alone: it only ever writes to stderr, and
  // it fires before any repo scan or stdout write has happened.)
  process.exitCode = report("check-answer-first", findings, argv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli("check-answer-first", main);
}

# jvto-ops Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable Claude Code plugin that encodes JVTO's operational rules as 12 skills, enforces the mechanical ones through 5 checker scripts wired to hooks, and stops the same work being re-derived every session.

**Architecture:** Scripts count, skills decide. Deterministic checks (word counts, dangling `@id`s, hash/file pairing, npm-script wiring) live in `scripts/` and are invoked by `hooks/hooks.json` on file edits and before pushes. Judgment (which three facts open a page, whether a claim overreaches) lives in `skills/*/SKILL.md`, invoked by name or auto-matched from its description. The plugin holds no project data: it reads `jvto-ekosistem` and `jvto-web` through env-var paths with sibling-directory fallback, the same convention `jvto-web/src/lib/ecosystemContent/*` already uses.

**Tech Stack:** Node 20 ESM (`.mjs`, no dependencies, `node:test` for tests), Python 3 stdlib for the live-site auditor, Markdown for skills, JSON for manifests and hooks.

**Spec:** `jvto-ekosistem/docs/answer-first-editorial-rules.md` (the one rule set already written down), plus the twelve-skill inventory and incident provenance agreed in conversation and reproduced in full in this plan's Task 6.

## Global Constraints

- Plugin name is `jvto-ops`; marketplace name is `jvto-ops`; install id is `jvto-ops@jvto-ops`.
- Repository is `jvto-devteam/jvto-ops`, created **private**. The skills document internal deploy protocols and incident history; publishing is a separate owner decision, reversible in one click.
- Zero runtime dependencies. No `node_modules` in this repo. Anything a script needs must be Node 20 stdlib or Python 3 stdlib.
- Every script exits `0` when clean, `1` when it has findings, and supports `--json`.
- Every script accepts `--repo-root <path>` to override discovery, so tests can point it at fixtures.
- No script may write to `jvto-ekosistem` or `jvto-web`. Checkers report; skills edit.
- Skills never decide a disputed fact. Where two sources disagree, the skill stops and asks.
- Skill frontmatter must carry `name`, `description`, `argument-hint`, and `user-invocable: true`.
- `claude plugin validate .` must pass before the final commit of every task that touches manifests or skills.

---

## File Structure

```
jvto-ops/
├── .claude-plugin/
│   ├── plugin.json              manifest: name, version, description, author
│   └── marketplace.json         makes the repo installable by `owner/repo`
├── README.md                    what it is, install, skill table, config, dev loop
├── hooks/hooks.json             5 triggers -> scripts
├── scripts/
│   ├── lib/repos.mjs            repo discovery + the shared finding/report contract
│   ├── check-answer-first.mjs   word count, fact count, fluff, literal-number drift
│   ├── check-graph-integrity.mjs dangling @id, duplicate inline nodes, withheld-asset refs
│   ├── check-ssot-drift.mjs     content assembled in jvto-web, FALLBACK no longer verbatim
│   ├── check-script-wiring.mjs  workflow references a missing npm script; orphaned audits
│   └── audit-answer-structure.py live-site fact density and answer structure
├── skills/                      12 x SKILL.md  (see Task 6)
├── test/
│   ├── fixtures/                minimal repo trees exercising each known defect
│   └── *.test.mjs               one node:test file per checker
└── docs/
    ├── goals-schema.md          shape of jvto-ekosistem/state/goals.json
    └── superpowers/plans/       this plan
```

Responsibilities are split so that a checker owns exactly one class of defect. `lib/repos.mjs` is the only file that knows where the sibling repos live; changing that convention touches one file.

---

## Task 1: Foundation — repo, manifests, README, repo discovery

**Files:**
- Create: `/Users/macbook/Code/jvto-ops/.claude-plugin/plugin.json`
- Create: `/Users/macbook/Code/jvto-ops/.claude-plugin/marketplace.json`
- Create: `/Users/macbook/Code/jvto-ops/scripts/lib/repos.mjs`
- Create: `/Users/macbook/Code/jvto-ops/test/repos.test.mjs`
- Create: `/Users/macbook/Code/jvto-ops/.gitignore`
- Create: `/Users/macbook/Code/jvto-ops/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces, from `scripts/lib/repos.mjs`:
  - `ekosystemRoot(): string` — `process.env.JVTO_EKOSYSTEM_ROOT` or `<cwd>/../jvto-ekosistem`
  - `webRoot(): string` — `process.env.JVTO_WEB_ROOT` or `<cwd>/../jvto-web`
  - `platformRoot(): string | null` — `process.env.JVTO_PLATFORM_ROOT` or `<cwd>/../jvto-platform`, `null` when absent
  - `requireRepo(label: string, dir: string): string` — returns `dir`, throws `Error` naming the env var when the directory does not exist
  - `finding(level: "error" | "warn", file: string, message: string, line?: number): Finding`
  - `report(checker: string, findings: Finding[], argv: string[]): number` — prints human lines or JSON when `argv` contains `--json`; returns the intended exit code (`1` when any finding has `level === "error"`, else `0`)
  - `Finding` is `{ level, file, message, line? }`

- [ ] **Step 1: Write the failing test**

Create `test/repos.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ekosystemRoot, requireRepo, finding, report } from "../scripts/lib/repos.mjs";

test("ekosystemRoot prefers the env var", () => {
  process.env.JVTO_EKOSYSTEM_ROOT = "/tmp/explicit-eko";
  assert.equal(ekosystemRoot(), "/tmp/explicit-eko");
  delete process.env.JVTO_EKOSYSTEM_ROOT;
});

test("requireRepo names the env var when the directory is missing", () => {
  assert.throws(
    () => requireRepo("ekosistem", "/tmp/definitely-not-here-4711"),
    /JVTO_EKOSYSTEM_ROOT|ekosistem/,
  );
});

test("requireRepo returns the directory when it exists", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jvto-ops-"));
  mkdirSync(path.join(dir, "sub"));
  assert.equal(requireRepo("ekosistem", dir), dir);
});

test("report exits 1 only when an error-level finding is present", () => {
  assert.equal(report("demo", [], []), 0);
  assert.equal(report("demo", [finding("warn", "a.json", "just a note")], []), 0);
  assert.equal(report("demo", [finding("error", "a.json", "broken")], []), 1);
});

test("report emits parseable JSON under --json", () => {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  report("demo", [finding("error", "a.json", "broken", 12)], ["--json"]);
  console.log = original;
  const parsed = JSON.parse(lines.join("\n"));
  assert.equal(parsed.checker, "demo");
  assert.equal(parsed.findings[0].line, 12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/macbook/Code/jvto-ops && node --test test/`
Expected: FAIL — `Cannot find module '../scripts/lib/repos.mjs'`

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/repos.mjs`:

```js
// Repo discovery for a plugin that lives outside the repos it inspects.
//
// Mirrors the convention jvto-web already uses in
// src/lib/ecosystemContent/*.ts: an explicit env var wins, otherwise assume a
// sibling checkout next to the current working directory. Nothing here writes
// to those repos — checkers report, skills edit.
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const ENV = {
  ekosistem: "JVTO_EKOSYSTEM_ROOT",
  web: "JVTO_WEB_ROOT",
  platform: "JVTO_PLATFORM_ROOT",
};

function sibling(name) {
  return path.resolve(process.cwd(), "..", name);
}

export function ekosystemRoot() {
  return process.env[ENV.ekosistem] ?? sibling("jvto-ekosistem");
}

export function webRoot() {
  return process.env[ENV.web] ?? sibling("jvto-web");
}

export function platformRoot() {
  const dir = process.env[ENV.platform] ?? sibling("jvto-platform");
  return existsSync(dir) ? dir : null;
}

export function requireRepo(label, dir) {
  const envVar = ENV[label] ?? `JVTO_${label.toUpperCase()}_ROOT`;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(
      `Cannot find the ${label} repository at ${dir}. ` +
        `Set ${envVar} to its absolute path, or run from a directory whose sibling is the checkout.`,
    );
  }
  return dir;
}

export function finding(level, file, message, line) {
  return line === undefined ? { level, file, message } : { level, file, message, line };
}

/**
 * Shared output contract so hooks can treat every checker the same way.
 * Exit 0 = nothing blocking. Exit 1 = at least one error-level finding.
 * Warnings are printed but never fail — a checker that cries wolf gets muted,
 * and a muted checker is worse than no checker.
 */
export function report(checker, findings, argv = process.argv.slice(2)) {
  const exitCode = findings.some((f) => f.level === "error") ? 1 : 0;

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ checker, findings }, null, 2));
    return exitCode;
  }

  if (findings.length === 0) {
    console.log(`${checker}: clean`);
    return exitCode;
  }

  for (const f of findings) {
    const where = f.line === undefined ? f.file : `${f.file}:${f.line}`;
    console.log(`${f.level.toUpperCase().padEnd(5)} ${where} — ${f.message}`);
  }
  const errors = findings.filter((f) => f.level === "error").length;
  const warns = findings.length - errors;
  console.log(`${checker}: ${errors} error(s), ${warns} warning(s)`);
  return exitCode;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/macbook/Code/jvto-ops && node --test test/`
Expected: PASS — 5 tests.

- [ ] **Step 5: Write the manifests**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "jvto-ops",
  "description": "Operational rules for the JVTO content ecosystem: answer-first editorial, evidence publishing, entity-graph integrity, and the two-repo deploy order — as skills that create and repair, plus checkers wired to hooks.",
  "version": "0.1.0",
  "author": { "name": "JVTO Dev Team" },
  "homepage": "https://github.com/jvto-devteam/jvto-ops",
  "repository": "https://github.com/jvto-devteam/jvto-ops",
  "license": "UNLICENSED",
  "keywords": ["jvto", "content", "seo", "aeo", "geo", "schema", "editorial"]
}
```

Create `.claude-plugin/marketplace.json`:

```json
{
  "name": "jvto-ops",
  "description": "JVTO operational tooling for Claude Code",
  "owner": { "name": "JVTO Dev Team" },
  "plugins": [
    {
      "name": "jvto-ops",
      "description": "Operational rules for the JVTO content ecosystem, as skills that create and repair.",
      "version": "0.1.0",
      "source": "./"
    }
  ]
}
```

Create `.gitignore`:

```
node_modules/
.answer-audit/
*.log
.DS_Store
```

- [ ] **Step 6: Write the README**

Create `README.md` with exactly these sections, in this order. Content notes follow each heading; write real prose, not placeholders.

1. `# jvto-ops` — one paragraph: what the plugin is for. State the split plainly: scripts count, skills decide. Name the two repos it guards (`jvto-ekosistem`, `jvto-web`) and the third it can help with (`jvto-platform`).
2. `## Why this exists` — three short paragraphs grounded in fact: 25 npm scripts exist across the two repos and only 20 are wired into CI or deploy; two of the orphans (`check:fact-drift`, `audit:geo-visibility`) currently report false failures because the code and the policy they inspect moved on without them; `jvto-web`'s `ci.yml` calls `npm run sync:trust`, which is not in `package.json`. The plugin's job is to wire, guard, and remember.
3. `## Install`

   ```bash
   claude plugin marketplace add jvto-devteam/jvto-ops
   claude plugin install jvto-ops@jvto-ops
   ```

   Then: `claude plugin details jvto-ops` to see the component inventory and projected token cost.
4. `## Configuration` — table of `JVTO_EKOSYSTEM_ROOT`, `JVTO_WEB_ROOT`, `JVTO_PLATFORM_ROOT`, each with its default (`../<name>` relative to the working directory) and a one-line note that the default matches how `jvto-web` already resolves `jvto-ekosistem`.
5. `## Skills` — a table with columns `Skill` / `Verbs` / `What it does`, one row per skill, using the exact `name` and `argument-hint` values from Task 6. Precede it with two sentences explaining that skills can be typed (`/jvto-ops:answer-first tighten the faq page`) or fire on their own from a description match, and that a skill invoked with no arguments prints its rules instead of acting.
6. `## Checkers` — a table with columns `Script` / `Fires on` / `Catches`, one row per script from Tasks 2–5, plus the `audit-answer-structure.py` row marked `manual / weekly` because it fetches 291 live pages.
7. `## Hooks` — reproduce the trigger table from Task 5 and state the policy: everything warns; only `check-graph-integrity` is allowed to block, because it is the only checker with no known false positives.
8. `## Goals file` — explain that `state/goals.json` lives in `jvto-ekosistem`, not here, because it is project state rather than plugin code, and link `docs/goals-schema.md`.
9. `## Development` — `node --test test/`, `claude plugin validate .`, `claude plugin tag .`, and a note that `claude plugin init` scaffolds a local copy at `~/.claude/skills/<name>/` that auto-loads as `<name>@skills-dir` for iterating without pushing.
10. `## What this plugin will not do` — three bullets: it never decides a disputed fact; it never writes editorial content from a script; it never treats low fact density on crew pages as a defect, because those pages are built from verbatim guest reviews.

- [ ] **Step 7: Validate the plugin manifest**

Run: `cd /Users/macbook/Code/jvto-ops && claude plugin validate .`
Expected: reports the manifest as valid. Skills and hooks are added in later tasks; a warning about there being no skills yet is acceptable at this stage, an error about `plugin.json` is not.

- [ ] **Step 8: Create the GitHub repository and push**

```bash
cd /Users/macbook/Code/jvto-ops
git add .gitignore .claude-plugin README.md scripts test docs
git commit -m "feat(foundation): plugin manifests, repo discovery, and the checker output contract

Scripts count, skills decide. This lands the half that counts: a shared
finding/report contract every checker uses, and the one file that knows
where jvto-ekosistem and jvto-web live.

Repo discovery mirrors the convention jvto-web already uses in
src/lib/ecosystemContent — an explicit env var wins, otherwise assume a
sibling checkout. Nothing here writes to those repos.

Warnings never fail the process. A checker that cries wolf gets muted, and
a muted checker is worse than no checker at all — which is exactly how
check:fact-drift and audit:geo-visibility ended up reporting false
failures for six days without anyone noticing."
gh repo create jvto-devteam/jvto-ops --private --source=. --remote=origin --description "Operational rules for the JVTO content ecosystem, as a Claude Code plugin"
git branch -M main
git push -u origin main
```

Expected: repository exists at `https://github.com/jvto-devteam/jvto-ops`, private, with `main` pushed.

---

## Task 2: `check-answer-first.mjs`

Catches the four mechanical failures of an answer block. Word count outside 40–60. Fewer than three quantified facts. A fluff-blacklist adjective standing alone. A volatile number written as a literal where a token exists.

**Files:**
- Create: `/Users/macbook/Code/jvto-ops/scripts/check-answer-first.mjs`
- Create: `/Users/macbook/Code/jvto-ops/test/check-answer-first.test.mjs`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/answer-first/short.source.json`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/answer-first/good.source.json`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/answer-first/literal-numbers.source.json`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/answer-first/fluffy.source.json`

**Interfaces:**
- Consumes: `finding`, `report`, `ekosystemRoot`, `requireRepo` from `scripts/lib/repos.mjs`.
- Produces: `export function checkAnswerFirst(text: string, filePath: string): Finding[]` — pure, no I/O, so tests can call it directly. The CLI wrapper walks `1-knowledge-and-evidence-core/**/*.source.json` plus `destination-knowledge/*.content.json` and calls it per file.

- [ ] **Step 1: Write the fixtures**

`test/fixtures/answer-first/good.source.json` — 52 words, five facts, no fluff, tokens for volatile numbers:

```json
{
  "meta": {
    "answerFirst": "Kawah Ijen is an active acidic crater lake at 2,386 m in Banyuwangi, East Java. Night ascents start from the Paltuding trailhead and run 4-5 hours round trip. A licensed guide is mandatory and BBKSDA Jawa Timur requires a health certificate before crater entry. Dry season runs April-October."
  }
}
```

`test/fixtures/answer-first/short.source.json` — 29 words, the exact defect the destinations hub carried before 2026-08-26:

```json
{
  "meta": {
    "answerFirst": "Every site on JVTO's East Java circuit is reached by dedicated private vehicle, with BBKSDA park clearance already in hand, and no shared groups at any point."
  }
}
```

`test/fixtures/answer-first/literal-numbers.source.json` — in range and fact-dense, but freezes two numbers that move:

```json
{
  "meta": {
    "answerFirst": "JVTO runs 17 private itineraries across East Java, departing Surabaya or Bali and ranging from 1D1N to 6D5N. Rated 4.9/5 from 153 Google reviews. Every tour is private, with park entrance fees and accommodation included. From IDR 1.55M/pax."
  }
}
```

`test/fixtures/answer-first/fluffy.source.json` — in range, but leans on adjectives:

```json
{
  "meta": {
    "answerFirst": "Kawah Ijen is a truly breathtaking destination and an unforgettable experience for every traveller. The stunning blue fire is the best sight in East Java, and our professional team makes it a once-in-a-lifetime trip you will treasure for many years."
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/check-answer-first.test.mjs`:

```js
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

test("a 29-word block is flagged as too short", () => {
  const messages = checkAnswerFirst(load("short"), "short.source.json").map((f) => f.message);
  assert.ok(messages.some((m) => /29 words/.test(m) && /40-60/.test(m)));
});

test("literal volatile numbers are flagged with the token that replaces them", () => {
  const messages = checkAnswerFirst(load("literal-numbers"), "x.source.json").map((f) => f.message);
  assert.ok(messages.some((m) => m.includes("{GOOGLE_REVIEW_COUNT}")));
  assert.ok(messages.some((m) => m.includes("{PRICE_FROM}")));
  assert.ok(messages.some((m) => m.includes("{PACKAGE_COUNT}")));
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/macbook/Code/jvto-ops && node --test test/check-answer-first.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/check-answer-first.mjs'`

- [ ] **Step 4: Write the implementation**

Create `scripts/check-answer-first.mjs`. Requirements, all of which the tests above pin:

- `WORD_MIN = 40`, `WORD_MAX = 60`.
- Word count splits on whitespace after stripping markdown link syntax.
- Fact patterns are the spec's list: a number with a unit (`m|km|kg|mdpl|minutes?|hours?|days?|nights?|pax|%|IDR|Rp`), an ISO date, a `Month YYYY`, a document number matching `\b(?:SE|AHU|SPRIN|NIB|TDUP|NPWP|STR|SIP|KTA)[.\-\s][A-Z0-9./-]{3,}`, a run of 9+ digits, and a named authority from `["BBKSDA", "Ditlantas", "POLRI", "Polres", "HPWKI", "DPMPTSP", "Kemenkumham", "Kemenparekraf", "Kemenkes", "BKPM", "Paltuding", "Tengger", "Bondowoso", "Banyuwangi"]`. Fewer than three distinct matches is one `error` finding whose message contains the phrase `fewer than three`.
- `FLUFF` is `["amazing", "unforgettable", "magical", "hidden paradise", "once-in-a-lifetime", "once in a lifetime", "breathtaking", "stunning", "the best", "most trusted", "number one", "world-class", "excellent service", "professional team", "competitive price", "truly unique", "must-see"]`. Each hit is its own `warn` finding naming the word, because one adjective beside a real number is defensible and a blanket error would get the checker muted.
- Volatile literals, each an `error` naming the replacement token:
  - `/\b\d{2,4}\s+Google reviews\b/i` → `{GOOGLE_REVIEW_COUNT}`
  - `/\b\d\.\d\s*\/\s*5\b/` → `{GOOGLE_RATING}`
  - `/\bIDR\s*[\d.]+\s*M\/pax\b/i` → `{PRICE_FROM}`
  - `/\b\d{1,3}\s+private itineraries\b/i` → `{PACKAGE_COUNT}`
- Word-count findings are `error` and the message must read exactly `<n> words, outside the 40-60 range`.
- The CLI wrapper: read every `*.source.json` under `<ekosistem>/1-knowledge-and-evidence-core` and every `*.content.json` under `<ekosistem>/1-knowledge-and-evidence-core/destination-knowledge`, pull `meta.answerFirst` (source files) or top-level `answerFirst` (content files), skip files that have none, and pass the rest through `checkAnswerFirst`. Accept a list of explicit file paths as positional arguments so the `PostToolUse` hook can check only the file just edited. End with `process.exit(report("check-answer-first", findings))`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/macbook/Code/jvto-ops && node --test test/check-answer-first.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 6: Prove it against the real repository**

Run: `cd /Users/macbook/Code/jvto-ops && JVTO_EKOSYSTEM_ROOT=/Users/macbook/Code/jvto-ekosistem node scripts/check-answer-first.mjs`
Expected: exits `0`. All 51 source pages and 5 destination records were brought into the 40–60 range on 2026-08-24, so a failure here means either a regression in the repo or a bug in the checker — investigate before proceeding, do not relax the rule.

- [ ] **Step 7: Commit**

```bash
cd /Users/macbook/Code/jvto-ops
git add scripts/check-answer-first.mjs test/check-answer-first.test.mjs test/fixtures/answer-first
git commit -m "feat(checker): catch the four mechanical failures of an answer block

Word count outside 40-60, fewer than three quantified facts, a fluff
adjective standing alone, and a volatile number written as a literal where
a token exists.

The last one is the reason this checker earns its place. The Google review
count moved 153 to 155 overnight while the blocks were being written, and
the tours pages still carry a hardcoded 'From IDR 1.55M' that the
catalogue floor passed long ago — it is IDR 1M. Fixtures freeze both
defects so the rule cannot quietly regress.

Fluff is a warning, never an error. One adjective beside a real number is
defensible, and a checker that blocks on taste gets muted."
```

---

## Task 3: `check-graph-integrity.mjs`

The only checker allowed to block, so it must have no known false positives.

**Files:**
- Create: `/Users/macbook/Code/jvto-ops/scripts/check-graph-integrity.mjs`
- Create: `/Users/macbook/Code/jvto-ops/test/check-graph-integrity.test.mjs`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/graph/dangling.json`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/graph/clean.json`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/graph/inline-duplicate.json`

**Interfaces:**
- Consumes: `finding`, `report` from `scripts/lib/repos.mjs`.
- Produces:
  - `export function collectGraph(docs: object[]): { defined: Set<string>, edges: Edge[], typesById: Map<string, Set<string>> }` where `Edge` is `{ src: string, pred: string, dst: string }`
  - `export function checkGraph(graph): Finding[]`
  - `VALUE_PREDICATES` — the exported `Set` of predicates whose values are URLs rather than node references: `url`, `sameAs`, `image`, `logo`, `contentUrl`, `thumbnailUrl`, `identifier`. Edges under these are never treated as references.

- [ ] **Step 1: Write the fixtures**

`test/fixtures/graph/clean.json` — every reference resolves:

```json
{
  "@graph": [
    { "@id": "https://x.test/#org", "@type": "Organization", "name": "X", "founder": { "@id": "https://x.test/#sam" } },
    { "@id": "https://x.test/#sam", "@type": "Person", "name": "Sam", "worksFor": { "@id": "https://x.test/#org" } }
  ]
}
```

`test/fixtures/graph/dangling.json` — reproduces the `#org-dumont-reiseverlag` defect: a `publisher` pointing at an id nothing defines, while the real node uses a different slug:

```json
{
  "@graph": [
    { "@id": "https://x.test/entity/#org-dumont", "@type": "Organization", "name": "DuMont Reiseverlag" },
    { "@id": "https://x.test/#org", "@type": "Organization", "name": "X", "publisher": { "@id": "https://x.test/entity/#org-dumont-reiseverlag" } },
    { "@id": "https://x.test/#page", "@type": "WebPage", "url": "https://x.test/only-a-url" }
  ]
}
```

`test/fixtures/graph/inline-duplicate.json` — reproduces the POLPAR defect: a registry node exists, and another node describes the same organisation inline without an `@id`:

```json
{
  "@graph": [
    { "@id": "https://x.test/entity/#org-polpar-bondowoso", "@type": "GovernmentOrganization", "name": "Polisi Pariwisata (POLPAR) Bondowoso" },
    {
      "@id": "https://x.test/#sam",
      "@type": "Person",
      "worksFor": [
        { "@id": "https://x.test/#org" },
        { "@type": "GovernmentOrganization", "name": "Polisi Pariwisata (POLPAR) Bondowoso", "url": "https://polri.go.id" }
      ]
    },
    { "@id": "https://x.test/#org", "@type": "Organization", "name": "X" }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `test/check-graph-integrity.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectGraph, checkGraph } from "../scripts/check-graph-integrity.mjs";

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/graph/${name}.json`, import.meta.url)));

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/macbook/Code/jvto-ops && node --test test/check-graph-integrity.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `scripts/check-graph-integrity.mjs`. Requirements:

- `collectGraph(docs)` walks every document depth-first. A node is **defined** when it carries an `@id` and at least one key besides `@id`. Record its `@type` values. Every nested object with an `@id` produces an edge `{ src, pred, dst }` from the nearest enclosing `@id`. Values under `VALUE_PREDICATES` are skipped entirely.
- `checkGraph(graph)` produces:
  - one `error` per distinct dangling `dst` — a reference whose id is never defined in any document — with a message of the form `` `<id>` is referenced by <predicates> but never defined ``. Only ids beginning `https://javavolcano-touroperator.com` or `https://x.test` are considered; anything else is an external URL.
  - one `error` per inline duplicate — an object with no `@id` whose `name` matches, case-insensitively after collapsing whitespace, the `name` of a node that *is* defined with an `@id`. Message form: `` inline node duplicates `<id>`; reference it by @id instead ``.
- The CLI wrapper reads every `*.schema-output.json` under `<ekosistem>/5-experience-engine/json-ld/pages`, and, when `--live` is passed, fetches the routes in `<web>/public/sitemap.xml` instead and extracts `application/ld+json` blocks. Default is the offline file scan so the `PreToolUse` hook stays fast.
- End with `process.exit(report("check-graph-integrity", findings))`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/macbook/Code/jvto-ops && node --test test/check-graph-integrity.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 6: Prove it against the real repository**

Run: `cd /Users/macbake/Code/jvto-ops 2>/dev/null || cd /Users/macbook/Code/jvto-ops; JVTO_EKOSYSTEM_ROOT=/Users/macbook/Code/jvto-ekosistem node scripts/check-graph-integrity.mjs`
Expected: exits `0`. The 14 dangling references found on 2026-08-22 were closed the same day; five remaining bare-page-URL references under `mainEntityOfPage`, `about`, `isPartOf` and `spatialCoverage` are a different, accepted class and must **not** be reported — if they are, the URL-value exemption is too narrow and the checker is not yet safe to block on.

- [ ] **Step 7: Commit**

```bash
cd /Users/macbook/Code/jvto-ops
git add scripts/check-graph-integrity.mjs test/check-graph-integrity.test.mjs test/fixtures/graph
git commit -m "feat(checker): dangling @id references and inline duplicate nodes

This is the only checker cleared to block a push, so it is the only one
whose false-positive rate has to be zero. Two exemptions earn that:
predicates whose values are URLs rather than references, and ids defined
on one document but referenced from another, which is how the entity
registry is designed to work.

Fixtures freeze the two defects that motivated it: a publisher edge
pointing at #org-dumont-reiseverlag while the registry defines
#org-dumont, and POLPAR written inline on the founder node while a
registry node for the same unit already existed — two organisations, as
far as a machine could tell."
```

---

## Task 4: `check-ssot-drift.mjs` and `check-script-wiring.mjs`

Two small checkers of the same shape: read files from a sibling repo, report structural problems. Batched into one task because neither is worth its own review gate.

**Files:**
- Create: `/Users/macbook/Code/jvto-ops/scripts/check-ssot-drift.mjs`
- Create: `/Users/macbook/Code/jvto-ops/scripts/check-script-wiring.mjs`
- Create: `/Users/macbook/Code/jvto-ops/test/check-ssot-drift.test.mjs`
- Create: `/Users/macbook/Code/jvto-ops/test/check-script-wiring.test.mjs`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/wiring/package.json`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/wiring/workflows/ci.yml`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/drift/assembled.tsx`
- Create: `/Users/macbook/Code/jvto-ops/test/fixtures/drift/clean.tsx`

**Interfaces:**
- Consumes: `finding`, `report`, `webRoot`, `requireRepo` from `scripts/lib/repos.mjs`.
- Produces:
  - `export function checkAssembledContent(source: string, file: string): Finding[]`
  - `export function checkWiring(pkgScripts: Record<string,string>, workflowText: string, opts: { allowManual: string[] }): Finding[]`

- [ ] **Step 1: Write the fixtures**

`test/fixtures/wiring/package.json` — has an orphaned audit and is missing a script the workflow calls:

```json
{
  "name": "fixture-web",
  "scripts": {
    "build": "next build",
    "sync:packages": "node scripts/sync-package-readiness.mjs",
    "audit:geo-visibility": "node scripts/audit-generative-visibility.mjs",
    "validate:jsonld-schema": "node scripts/validate-jsonld-schema.mjs"
  }
}
```

`test/fixtures/wiring/workflows/ci.yml` — calls a script that does not exist, exactly as `jvto-web/.github/workflows/ci.yml` calls `sync:trust`:

```yaml
name: CI
on: [push]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
      - run: npm run sync:packages
      - run: npm run sync:trust
      - run: npm run validate:jsonld-schema
```

`test/fixtures/drift/assembled.tsx` — prose built in the consumer instead of read from ekosistem:

```tsx
export default function Page({ tours }: { tours: Tour[] }) {
  const answerFirst =
    `Choose from ${tours.length} private Bromo, Ijen and Tumpak Sewu tours from Surabaya or Bali. ` +
    `JVTO runs no shared groups: each booking gets private transport and confirmed crew. ` +
    `Prices start from IDR 1.55M/pax.`;
  return <Hero answerFirst={answerFirst} />;
}
```

`test/fixtures/drift/clean.tsx` — same page, reading from ekosistem with the derived string kept only as a fallback:

```tsx
export default function Page({ page, tours }: { page: EcosystemPage; tours: Tour[] }) {
  const answerFirst =
    typeof page?.raw?.page?.answerFirst === "string"
      ? page.raw.page.answerFirst
      : `Choose from ${tours.length} private tours.`;
  return <Hero answerFirst={answerFirst} />;
}
```

- [ ] **Step 2: Write the failing tests**

Create `test/check-script-wiring.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkWiring } from "../scripts/check-script-wiring.mjs";

const pkg = JSON.parse(readFileSync(new URL("./fixtures/wiring/package.json", import.meta.url)));
const wf = readFileSync(new URL("./fixtures/wiring/workflows/ci.yml", import.meta.url), "utf8");

test("a workflow calling a script that does not exist is an error", () => {
  const findings = checkWiring(pkg.scripts, wf, { allowManual: [] });
  const missing = findings.filter((f) => f.level === "error");
  assert.equal(missing.length, 1);
  assert.ok(missing[0].message.includes("sync:trust"));
});

test("an audit script no workflow calls is a warning, not an error", () => {
  const findings = checkWiring(pkg.scripts, wf, { allowManual: [] });
  const orphan = findings.find((f) => f.message.includes("audit:geo-visibility"));
  assert.equal(orphan.level, "warn");
});

test("a script on the manual allowlist is not reported as orphaned", () => {
  const findings = checkWiring(pkg.scripts, wf, { allowManual: ["audit:geo-visibility"] });
  assert.ok(!findings.some((f) => f.message.includes("audit:geo-visibility")));
});

test("non-audit scripts are never reported as orphaned", () => {
  const findings = checkWiring(pkg.scripts, wf, { allowManual: [] });
  assert.ok(!findings.some((f) => f.message.includes("build")));
});
```

Create `test/check-ssot-drift.test.mjs`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/macbook/Code/jvto-ops && node --test test/check-script-wiring.test.mjs test/check-ssot-drift.test.mjs`
Expected: FAIL — both modules not found.

- [ ] **Step 4: Write both implementations**

`scripts/check-script-wiring.mjs`:

- `checkWiring(pkgScripts, workflowText, { allowManual })` extracts every `npm run <name>` from `workflowText`. Any name absent from `pkgScripts` is an `error`: `` workflow calls `npm run <name>` but package.json has no such script ``. Any key of `pkgScripts` starting `audit:`, `validate:` or `check:` that appears in neither `workflowText` nor `allowManual` is a `warn`: `` `<name>` is defined but no workflow runs it — wire it or add it to allowManual ``.
- CLI: read `<web>/package.json` and concatenate every file under `<web>/.github/workflows`, then do the same for `<ekosistem>`. `allowManual` defaults to `["audit:geo-visibility", "audit:travel-guide:live", "check:fact-drift"]` with an inline comment recording that these three are deliberately manual **for now** and that the intent is to fix and wire them.

`scripts/check-ssot-drift.mjs`:

- `checkAssembledContent(source, file)` reports an `error` when a `const <name> =` whose name matches `/answerFirst|lede|summary|description/i` is assigned a template literal or string concatenation of **more than 60 characters** that is not guarded by a read from `page?.raw`, `pc.`, or `ecosystemPage`. Message: `` `<name>` builds page prose in the consumer; read it from ekosistem and keep this only as a FALLBACK ``.
- CLI: walk `<web>/src/app` and `<web>/src/components` for `.tsx`, skipping any file whose path contains `/FALLBACK` or that is under `src/lib/schemas`, and call the function per file.
- Both scripts end with `process.exit(report(<name>, findings))`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/macbook/Code/jvto-ops && node --test test/check-script-wiring.test.mjs test/check-ssot-drift.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 6: Prove `check-script-wiring` finds the real defect**

Run: `cd /Users/macbook/Code/jvto-ops && JVTO_WEB_ROOT=/Users/macbook/Code/jvto-web JVTO_EKOSYSTEM_ROOT=/Users/macbook/Code/jvto-ekosistem node scripts/check-script-wiring.mjs`
Expected: exits `1`, and the output names `sync:trust` as called by a workflow but missing from `package.json`. This is a real, currently-live defect: `jvto-web` CI has failed on it since 2026-08-19. Record the exact output in the commit message.

- [ ] **Step 7: Commit**

```bash
cd /Users/macbook/Code/jvto-ops
git add scripts/check-ssot-drift.mjs scripts/check-script-wiring.mjs test/check-ssot-drift.test.mjs test/check-script-wiring.test.mjs test/fixtures/wiring test/fixtures/drift
git commit -m "feat(checker): SSOT drift in the consumer, and npm scripts nothing runs

check-script-wiring exists because of a defect it finds on its first run:
jvto-web's ci.yml calls 'npm run sync:trust', which is not in
package.json. That CI job has failed since 2026-08-19 and nobody noticed,
because production deploys from the live branch through a different
workflow.

It also warns about audit and validate scripts no workflow calls. Six of
them exist across the two repos. Three are allowlisted as deliberately
manual for now; the allowlist is meant to shrink.

check-ssot-drift catches prose assembled in a React file instead of read
from ekosistem — the pattern the tours hub carried, where the answer
sentence and a locally computed price floor were built in the consumer."
```

---

## Task 5: Live-site auditor, goals schema, and hooks

**Files:**
- Create: `/Users/macbook/Code/jvto-ops/scripts/audit-answer-structure.py` (ported from `jvto-web/scripts/audit-answer-structure.py`)
- Create: `/Users/macbook/Code/jvto-ops/hooks/hooks.json`
- Create: `/Users/macbook/Code/jvto-ops/docs/goals-schema.md`

**Interfaces:**
- Consumes: nothing from earlier tasks; the hooks reference the four checker scripts by path.
- Produces: `hooks/hooks.json`, read by Claude Code at plugin load.

- [ ] **Step 1: Port the auditor**

Copy `/Users/macbook/Code/jvto-web/scripts/audit-answer-structure.py` to `/Users/macbook/Code/jvto-ops/scripts/audit-answer-structure.py` verbatim, then make exactly two changes: default the HTML cache directory to `.answer-audit/html` relative to the current working directory, and add `--base-url` defaulting to `https://javavolcano-touroperator.com`. Keep both encoded judgment calls and their comments unchanged — it must not strip `<header>`, and it must not treat low fact density on crew pages as a defect.

- [ ] **Step 2: Verify the port still measures correctly**

Run: `cd /Users/macbook/Code/jvto-ops && ANSWER_AUDIT_HTML_DIR=/private/tmp/claude-501/-Users-macbook-Code-jvto-ekosistem/097a0990-d3b4-478a-8748-5ce0c1fb65e4/scratchpad/aeo/html python3 scripts/audit-answer-structure.py`
Expected: prints the per-page-type table. The `destination` row must read `6/6` under the `≥3 angka` column and `crew` must read `11/11`; those are the values measured on 2026-08-24 against the same cached HTML. Different numbers mean the port changed behaviour.

- [ ] **Step 3: Write the goals schema doc**

Create `docs/goals-schema.md` describing `jvto-ekosistem/state/goals.json`, with this exact shape and a worked example:

```json
{
  "updated": "2026-08-26",
  "baseline": {
    "measuredAt": "2026-08-24",
    "tool": "scripts/audit-answer-structure.py",
    "byPageType": { "destination": { "density": 0.48, "threeNumbersInFirst120": "6/6" } }
  },
  "backlog": [
    { "id": "P0-3", "title": "Review nodes on the 17 package pages", "status": "open", "evidence": "0 of 17 tour pages emit a Review node; crew pages emit 11 of 11" }
  ],
  "decisions": [
    {
      "id": "content-signal-ai-train",
      "date": "2026-08-18",
      "decision": "Content-Signal is search=yes,ai-train=yes,use=reference",
      "why": "robots.ts already allows every AI-training crawler and AEO/GEO visibility is a stated goal; the header said ai-train=no and contradicted it",
      "commit": "904e8219"
    }
  ]
}
```

State the rule that makes the `decisions` block load-bearing: a checker must read a policy from here rather than freezing it in its own source. `audit:geo-visibility` froze `ai-train=no` and reported eleven false failures for six days after the owner changed the policy.

- [ ] **Step 4: Write the hooks**

Create `hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-brief.mjs\"",
            "shell": "bash",
            "async": false
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-dispatch.mjs\" post-edit",
            "shell": "bash",
            "async": false
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-dispatch.mjs\" pre-push",
            "shell": "bash",
            "async": false
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Write the two hook entry points**

Create `scripts/session-brief.mjs`: read `<ekosistem>/state/goals.json` if it exists and print a short brief — the baseline date, every backlog item whose `status` is `open`, and the count of `decisions`. Print nothing and exit `0` when the file is absent, so a fresh checkout is silent rather than noisy.

Create `scripts/hook-dispatch.mjs`: read the hook payload from stdin as JSON. For `post-edit`, take `tool_input.file_path`; run `check-answer-first` when it matches `*.source.json` or `*.content.json` under `1-knowledge-and-evidence-core`, run `check-ssot-drift` when it is a `.tsx` under `jvto-web/src`, run `check-script-wiring` when it is a `package.json` or under `.github/workflows`. For `pre-push`, inspect `tool_input.command`; when it matches `git push`, run `check-graph-integrity` and exit non-zero if it fails. Every other case prints nothing and exits `0`. Never run more than one checker per invocation, and never run the live auditor from a hook — it fetches 291 pages.

- [ ] **Step 6: Test the dispatcher**

Create `test/hook-dispatch.test.mjs` asserting that a `post-edit` payload naming a `.tsx` path selects `check-ssot-drift`, that a payload naming a `README.md` selects nothing and exits `0`, and that a `pre-push` payload whose command is `git status` selects nothing. Export a pure `selectChecker(mode, payload): string | null` from `hook-dispatch.mjs` so this is testable without spawning processes.

Run: `cd /Users/macbook/Code/jvto-ops && node --test test/`
Expected: PASS — all suites.

- [ ] **Step 7: Commit**

```bash
cd /Users/macbook/Code/jvto-ops
git add scripts/audit-answer-structure.py scripts/session-brief.mjs scripts/hook-dispatch.mjs hooks/hooks.json docs/goals-schema.md test/hook-dispatch.test.mjs
git commit -m "feat(hooks): fire one checker per edit, and brief the session on open work

The dispatcher picks exactly one checker from the edited path and runs
nothing otherwise, so the common case — editing a README — costs nothing.
The live auditor is deliberately unreachable from a hook; it fetches 291
pages.

session-brief reads state/goals.json from jvto-ekosistem and prints the
open backlog at session start. That file is also where policy decisions
live, so a checker can read a policy instead of freezing it in its own
source — which is how audit:geo-visibility ended up asserting ai-train=no
for six days after the owner had decided otherwise."
```

---

## Task 6: The twelve skills

Batched deliberately: same shape, content already decided, and a reviewer would accept or reject them as a set.

**Files:** create `skills/<name>/SKILL.md` for each of the twelve below.

**Interfaces:**
- Consumes: the checker names and CLI signatures from Tasks 2–5, referenced by path inside skill bodies.
- Produces: nothing other tasks depend on.

Every file starts with this frontmatter shape, values per the table:

```yaml
---
name: <name>
description: <one sentence, written so the model can match it to a situation without being told>
argument-hint: "[<verb> · <verb> · <verb>] [target]"
user-invocable: true
---
```

Every body has these sections, in order: **When this applies**, **Rules** (numbered, each with the incident that produced it), **Create**, **Repair**, **Checked by** (naming the script, or `none — judgment only`), and **Stops and asks** (the cases where the skill must not decide).

| name | argument-hint verbs | description must convey |
|---|---|---|
| `answer-first` | write · tighten · retoken | writing or fixing the 40–60 word block that opens a page |
| `content-page` | new · reclaim · retire | creating a content page end to end, or moving prose out of jvto-web back into ekosistem |
| `claim-restraint` | source · retract · disentangle | how JVTO states things: say how we know, separate regulator from issuer from registry from carbon copy |
| `evidence` | publish · rehash · reclassify | publishing a document with a hash, or correcting evidenceStatus |
| `entity-graph` | add · link · dedupe · repair | adding an organisation to the registry, or closing dangling `@id`s |
| `crew` | add · attribute · alias | adding a crew member, or backfilling review attribution |
| `pii` | redact · reverify | redacting a document before or after publication |
| `ship` | ship · diagnose · rerun | running the two-repo deploy in the right order, or diagnosing a failure |
| `measure` | baseline · compare · validate | taking a measurement baseline and comparing against the last one |
| `checker-hygiene` | write · repair · unfreeze | writing a checker, or repairing one that rotted |
| `platform-connector` | implement · audit | writing a jvto-platform connector that reads without becoming a third source of truth |
| `platform-consolidate` | merge · register · test | reconciling jvto-platform's duplicated scaffolding |

The **Rules** sections must carry these specifics verbatim in substance:

- `answer-first`: 40–60 words; pattern `[Subject] is [definition]. [Fact 1]. [Fact 2]. [Qualification].`; position directly under the hero lede; at least three quantified facts; no new claims; volatile numbers as `{GOOGLE_RATING}` `{GOOGLE_REVIEW_COUNT}` `{PACKAGE_COUNT}` `{PRICE_FROM}` (the Google count moved 153→155 overnight); state the limitation where one exists; when two sources disagree omit the number and report (Madakaripura is 200 m in `display_height_m` and `summary`, "~100 m" in `hero_meta_override`); no pronouns for people whose pronouns are not recorded; count from the SSOT rather than asserting.
- `content-page`: the eight shipping steps, with step 3 spelled out — a plain `npm run build` in jvto-web reads the **deployed** content API because `.env` sets `JVTO_EKOSYSTEM_CONTENT_BASE_URL`, so a new block silently fails to render; force the local read by emptying that variable and setting `JVTO_EKOSYSTEM_CONTENT_ROOT`.
- `claim-restraint`: say how we know, not only what we know; four roles that get confused — regulator, issuer, registry, carbon copy (the SIP is issued by DPMPTSP Bondowoso; Kemenkes appears on that document as the enabling regulation and as first carbon copy, never as issuer); retract unsourced figures rather than softening them; an owner assertion is not a document.
- `evidence`: SHA-256 for every published document, tested against the file on disk; `evidenceStatus` is `verified`, `candidate`, or `media_sourced`, never a guess; stamp only what was actually checked (a verification script once stamped 44 assets it never opened; a proper check found 13 stale hashes); when the document is not held, say so.
- `entity-graph`: every referenced `@id` must be defined somewhere; one real-world entity is one node — no inline duplicate of a registry entry; relations between two registry entries are edges, not prose; never reference an asset that is deliberately not published; `recognizedBy` names the actual issuer, read from the document.
- `crew`: union never replace when backfilling; index the roster under every name form (`Boy (Ahboy)` versus the alias rule's `Boy` silently dropped every alias for one crew member); an ambiguous alias gets a manual per-review tag, never an automatic rule (review #287 "Driver Joy" is still untagged).
- `pii`: true redaction that scrubs pixels; verify by sampling the extracted image, not the rendered page; rehash afterwards; check derivatives — three preview images carried NIK numbers the audit list had missed.
- `ship`: ekosistem first, wait for the content API to serve the route, then jvto-web; the web build fetches content over HTTP while its own audit reads files from disk, so deploying both at once fails the gate on pages that are correct; never `git add -A` in a working directory shared by concurrent sessions; revert timestamp-only regenerated files selectively; read the log before calling a failure a flake.
- `measure`: baseline before, same tool after; validate the measurer on a case whose answer is already known (the first version stripped `<header>`, which is the page hero on most routes here, and the second read only `<p>`, missing the answer block that renders as a `<div>`); encode judgment calls in the tool.
- `checker-hygiene`: when you change the code or policy a checker inspects, update the checker in the same commit; a checker that freezes a policy constant must read it from `state/goals.json` instead; every checker ships with a fixture reproducing the defect it was written for.
- `platform-connector`: the connector reads, it does not own; every record stores its source and read time; when the source changes, the copy is marked stale rather than quietly kept; the current connector returns a fixed `{"source": "jvto-ekosistem", "status": "ready_for_sync"}` and touches nothing.
- `platform-consolidate`: `app/modules/` and `app/services/` carry eight identically named files and only `services/` is imported by the API layer; six of sixteen route modules are never registered in the router; four DB model files exist including one prefixed `final_`; there are no tests.

- [ ] **Step 1: Write all twelve SKILL.md files** per the table and rule list above.

- [ ] **Step 2: Validate**

Run: `cd /Users/macbook/Code/jvto-ops && claude plugin validate .`
Expected: valid; twelve skills discovered.

- [ ] **Step 3: Check the inventory and token cost**

Run: `cd /Users/macbook/Code/jvto-ops && claude plugin details . 2>/dev/null || claude plugin validate .`
Expected: twelve skills listed. If a projected token cost is reported and any single skill exceeds roughly 2,000 tokens, trim its prose — a skill is a rule sheet, not an essay.

- [ ] **Step 4: Commit**

```bash
cd /Users/macbook/Code/jvto-ops
git add skills
git commit -m "feat(skills): twelve rule sheets that create and repair, not just review

Each skill carries three verbs — create, repair, guard — because a skill
that only reviews is half a skill. The scripts count; these decide.

Every rule names the incident that produced it, because a rule without its
incident reads as a preference and gets argued with. The Google review
count moving 153 to 155 overnight is why volatile numbers are tokens. A
verification script stamping 44 assets it never opened is why evidence
only stamps what it checked. POLPAR written inline beside a registry node
for the same unit is why one entity means one node.

All twelve stop and ask rather than decide a disputed fact."
```

---

## Task 7: Publish, install, and verify end to end

**Files:**
- Modify: `/Users/macbook/Code/jvto-ops/README.md` (fill the Skills and Checkers tables with the shipped values)
- Modify: `/Users/macbook/Code/jvto-ops/.claude-plugin/plugin.json` (bump to `0.1.0` final if changed)

- [ ] **Step 1: Fill the README tables from the shipped artefacts**

Read `skills/*/SKILL.md` frontmatter and fill the Skills table's `Skill`, `Verbs` and `What it does` columns from the actual `name`, `argument-hint` and `description` values. Fill the Checkers table from the four `check-*.mjs` scripts plus the Python auditor. No invented rows.

- [ ] **Step 2: Full test run and validation**

```bash
cd /Users/macbook/Code/jvto-ops
node --test test/
claude plugin validate .
```
Expected: all tests pass; manifest valid.

- [ ] **Step 3: Commit and push**

```bash
cd /Users/macbook/Code/jvto-ops
git add README.md .claude-plugin
git commit -m "docs(readme): fill the skill and checker tables from what shipped"
git push
```

- [ ] **Step 4: Install from GitHub and verify it loads**

```bash
claude plugin marketplace add jvto-devteam/jvto-ops
claude plugin install jvto-ops@jvto-ops
claude plugin details jvto-ops
```
Expected: twelve skills and three hook triggers listed.

- [ ] **Step 5: Tag the release**

```bash
cd /Users/macbook/Code/jvto-ops
claude plugin tag .
git push --tags
```
Expected: tag `jvto-ops--v0.1.0` created and pushed, with `plugin.json` and the marketplace entry agreeing.

- [ ] **Step 6: Report the one live defect the plugin already found**

`check-script-wiring` fails on `jvto-web`, naming `sync:trust` as called by `ci.yml` but absent from `package.json`. Do **not** fix it in this plan — it is a change to another repository. Record it as the first entry in the handoff so the owner decides.

---

## Self-Review

**Spec coverage.** All twelve skills from the agreed inventory have a row in Task 6 with their verbs and rule specifics. All five scripts named in the design have a task: `check-answer-first` (Task 2), `check-graph-integrity` (Task 3), `check-ssot-drift` and `check-script-wiring` (Task 4), `audit-answer-structure.py` (Task 5). Hooks, goals schema, README and installability are Tasks 1, 5 and 7. `commands/` was dropped deliberately: `measure` and `ship` are skills with verbs, so a parallel command directory would duplicate them.

**Placeholder scan.** No TBDs. Every code step carries the actual code or an exact behavioural specification pinned by a named test. Task 6 specifies content by substance rather than reproducing twelve full files, which is the one place a reviewer should check most carefully — the rule list is the contract.

**Type consistency.** `finding(level, file, message, line?)` and `report(checker, findings, argv)` are defined once in Task 1 and used unchanged in Tasks 2–5. `checkAnswerFirst`, `collectGraph`/`checkGraph`, `checkAssembledContent`, `checkWiring` and `selectChecker` are each named once and referenced consistently by their tests. Env vars `JVTO_EKOSYSTEM_ROOT`, `JVTO_WEB_ROOT`, `JVTO_PLATFORM_ROOT` are spelled identically in Task 1, the README section list, and Tasks 2–4 verification steps.

**One known defect in this plan:** Task 3 Step 6 contains a typo'd fallback path (`/Users/macbake/...`) guarded by `||`; the implementer should simply run the second half of that line.

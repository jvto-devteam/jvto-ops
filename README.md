# jvto-ops

`jvto-ops` is a Claude Code plugin that holds the operational rules of the JVTO content
ecosystem — answer-first editorial, evidence publishing, entity-graph integrity, and the
two-repo deploy order — as skills that create and repair, backed by checker scripts that
only report. The split is deliberate: scripts count, skills decide. The plugin guards
`jvto-ekosistem` (the content and knowledge-graph source) and `jvto-web` (the site that
renders it), and can additionally help with `jvto-platform` when that repo is present.

## Why this exists

36 npm scripts exist across `jvto-ekosistem` (22) and `jvto-web` (14), and only 20 of them
are referenced by a workflow. The other 16 run only when someone remembers to run them by
hand, which in practice means they drift.

Two of those orphans currently report false failures because the code and the policy they
inspect moved on without them. `check:fact-drift` extracts facts by pattern-matching
`FOUNDER_SCHEMA.name`, a constant that was refactored into `buildFounderSchema(facts)`, so
it now finds nothing and reports drift that isn't there. `audit:geo-visibility` freezes the
assertion `ai-train=no` in its own source, but the owner changed that policy to
`ai-train=yes` on 2026-08-18 in commit `904e8219` — the checker has been contradicting a
six-day-old decision ever since. Separately, `jvto-web/.github/workflows/ci.yml` calls
`npm run sync:trust`: the last green run of that workflow was 2026-08-11, and the script it
calls stopped existing on 2026-08-15, removed from `package.json` in commit `1542fb08`.

None of these are exotic failures — they are what happens when a script's assumptions and
the codebase's reality are allowed to diverge silently. The plugin's job is to wire, guard,
and remember: wire orphaned scripts into a place they get run, guard edits with checkers
that read current policy instead of freezing it, and remember open backlog and past
decisions across sessions instead of relying on any one person's memory of why something
is the way it is.

## Findings

The plugin's own checkers already surfaced two defects in the ecosystem it guards — the
kind of thing it exists to catch.

`check-answer-first`, on its first run against the real `jvto-ekosistem`, found that all
eleven crew answer blocks had shipped with an empty KTA credential code: a generator read
`kta.credentialId` while the roster actually stores the field as `kta.id`. Eleven of the
checker's thirty-eight findings on that run were that one defect, repeated once per crew
member. It has since been fixed and deployed.

`check-script-wiring` finds that `jvto-web`'s `ci.yml` calls `npm run sync:trust`, a script
removed from `package.json` on 2026-08-15 in commit `1542fb08`. The last green run of that
workflow was 2026-08-11. **This one is still open.** It is a change to another repository —
`jvto-web`, not `jvto-ops` — and fixing it here would be out of scope; it is the owner's
call to make, either by restoring the script or by removing the workflow step that calls
it.

## Install

```bash
claude plugin marketplace add jvto-devteam/jvto-ops
claude plugin install jvto-ops@jvto-ops
```

Then: `claude plugin details jvto-ops` to see the component inventory and projected token
cost.

## Configuration

| Variable | Default | Note |
| --- | --- | --- |
| `JVTO_EKOSYSTEM_ROOT` | `../jvto-ekosistem` relative to the working directory | Same sibling-checkout convention `jvto-web` already uses to resolve `jvto-ekosistem` in `src/lib/ecosystemContent`. |
| `JVTO_WEB_ROOT` | `../jvto-web` relative to the working directory | Same sibling-checkout convention `jvto-web` already uses to resolve `jvto-ekosistem` in `src/lib/ecosystemContent`. |
| `JVTO_PLATFORM_ROOT` | `../jvto-platform` relative to the working directory | Same sibling-checkout convention `jvto-web` already uses to resolve `jvto-ekosistem` in `src/lib/ecosystemContent`. |

## Skills

A skill can be typed as `/jvto-ops:<name>` or fire on its own when its description matches
what's being worked on. Invoked with no arguments, a skill prints its rules instead of
acting.

| Skill | Verbs | What it does |
| --- | --- | --- |
| `/jvto-ops:answer-first` | write · tighten · retoken | Write or tighten the 40-60 word answer-first block that opens a page — the definition-plus-facts block sitting directly under the hero lede, with volatile numbers as tokens, no invented claims, and disputed facts omitted rather than guessed. |
| `/jvto-ops:checker-hygiene` | write · repair · unfreeze | Write a new Node checker (any script sharing the `repos.mjs` finding/report contract) or repair one that's rotted — when the code or policy a checker inspects changes, the checker changes in the same commit, or it starts crying wolf on a policy that already moved on. |
| `/jvto-ops:claim-restraint` | source · retract · disentangle | Write how JVTO knows something, not only what it knows — separating regulator, issuer, registry, and carbon copy so a claim about a permit or credential names its actual source, and retracting rather than softening a figure with no source. |
| `/jvto-ops:content-page` | new · reclaim · retire | Create a content page end to end in `jvto-ekosistem`, or reclaim prose that drifted into `jvto-web` back to the source of truth — including the local-build step that makes a new block silently invisible if skipped. |
| `/jvto-ops:crew` | add · attribute · alias | Add a crew member to the roster, backfill review attribution by union rather than replacement, or register an alias form — an ambiguous alias always gets a manual tag, never an automatic rule. |
| `/jvto-ops:entity-graph` | add · link · dedupe · repair | Add an organisation or person to the entity registry, link or dedupe references between registry entries, or close a dangling `@id` — the one integrity check cleared to block a `git push`. |
| `/jvto-ops:evidence` | publish · rehash · reclassify | Publish a document with a SHA-256 hash tested against the file on disk, or correct an `evidenceStatus` after actually checking the file — never stamping verified on something nobody opened. |
| `/jvto-ops:measure` | baseline · compare · validate | Take a live-site measurement baseline with the standalone Python auditor (`audit-answer-structure.py`, not one of the Node `repos.mjs` checkers) before an editorial change and compare against it after, using a measurer that's been validated on a case whose answer is already known — not trusted on its first run. |
| `/jvto-ops:pii` | redact · reverify | Redact personally identifying data from a document before publication, or reverify one already published — true pixel-level redaction confirmed by sampling the extracted image, not the rendered page, and checked against derivatives too. |
| `/jvto-ops:platform-connector` | implement · audit | Implement or audit a `jvto-platform` connector that reads from `jvto-ekosistem` without becoming a third source of truth — every record stamped with its source and read time, marked stale when the source changes underneath it. |
| `/jvto-ops:platform-consolidate` | merge · register · test | Reconcile `jvto-platform`'s duplicated scaffolding — two directories of identically named files, routes never registered in the router, a stray `final_`-prefixed model, and no tests — before adding anything new to it. |
| `/jvto-ops:ship` | ship · diagnose · rerun | Run the two-repo deploy in ekosistem-then-web order and diagnose a failed gate — deploying both repos at once fails the visible-content gate on pages that are actually correct, because the build and the audit read content from two different places. |

## Checkers

| Script | Fires on | Catches |
| --- | --- | --- |
| `check-answer-first` | `PostToolUse` (`Edit\|Write`), when the edited path is under `jvto-ekosistem`, passes through a `1-knowledge-and-evidence-core` segment, and ends in `.source.json` or `.content.json`. | Word count outside 40-60; fewer than three quantified, distinct facts; a fluff-blacklist adjective standing alone (warning only); a volatile number written as a literal where a stable token exists. |
| `check-ssot-drift` | `PostToolUse` (`Edit\|Write`), when the edited path is a `.tsx` under `jvto-web/src`. | Page prose assembled inline in a jvto-web consumer component instead of read from jvto-ekosistem — an `answerFirst`/`lede`/`summary`/`description` const whose value splices in a runtime expression (template-literal interpolation, or a `+` join with something other than a plain string/template literal). A `??` fallback to a literal is exempted on purpose. |
| `check-script-wiring` | `PostToolUse` (`Edit\|Write`), when the edited path's basename is `package.json` or the path includes `/.github/workflows/`, under either `jvto-ekosistem` or `jvto-web`. | A workflow calling `npm run <name>` for a script `package.json` doesn't define (error); an `audit:*`/`validate:*`/`check:*` script that no workflow runs at all (warning — may be deliberately manual). |
| `check-graph-integrity` | `PreToolUse` (`Bash`), when the command is an actual invocation of `git push` (including a dry run), not merely a mention of the words inside a quoted string or a grep pattern. | Dangling `@id` references in the entity graph and inline duplicate nodes of an entity already in the registry. The only checker cleared to block the tool call. |
| `audit-answer-structure.py` | manual / weekly — no hook reaches it; it fetches all 291 live pages, too slow for any per-edit or per-push trigger. | Live-site fact density and answer-structure conformance against the spec, measured before and after an editorial change with the same tool so an improvement claim is actually checkable. |

## Hooks

| Hook | Matcher | Dispatches to | Selection |
| --- | --- | --- | --- |
| `SessionStart` | `startup\|clear\|compact` | `scripts/session-brief.mjs` | Always — prints the open backlog from `state/goals.json` if that file exists, prints nothing otherwise. |
| `PostToolUse` | `Edit\|Write` | `scripts/hook-dispatch.mjs post-edit` | By the edited path: `*.source.json` / `*.content.json` under `1-knowledge-and-evidence-core` → `check-answer-first`; a `.tsx` under `jvto-web/src` → `check-ssot-drift`; `package.json` or anything under `.github/workflows` → `check-script-wiring`. |
| `PreToolUse` | `Bash` | `scripts/hook-dispatch.mjs pre-push` | When the command matches `git push` → `check-graph-integrity`. Every other command dispatches nothing. |

The policy across all of it: everything warns, and only `check-graph-integrity` is allowed
to block a push. It is the only checker in this plugin with no known false positives — the
other checkers report findings but never fail the hook, because a checker that cries wolf
gets muted, and a muted checker is worse than no checker at all.

## Goals file

Open backlog, measured baselines, and policy decisions live in
`jvto-ekosistem/state/goals.json`, not in this repository. That file is project state, not
plugin code — it changes with every editorial decision the ecosystem makes, while the
plugin itself changes only when the operational rules change. Its shape is documented in
[`docs/goals-schema.md`](docs/goals-schema.md).

## Development

```bash
node --test
claude plugin validate .
claude plugin tag .
```

`claude plugin init` scaffolds a local copy at `~/.claude/skills/<name>/` that auto-loads as
`<name>@skills-dir`, which is the fastest way to iterate on a skill without pushing a commit
for every change.

## What this plugin will not do

- It never decides a disputed fact. Checkers flag inconsistency; a human resolves it.
- It never writes editorial content from a script. Skills draft and repair; scripts only
  read and report.
- It never treats low fact density on crew pages as a defect. Crew pages are built from
  verbatim guest reviews, and rewriting a guest's words to hit a numeric-density target
  would be worse than leaving the page alone.

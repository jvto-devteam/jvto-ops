# jvto-ops

`jvto-ops` is a Claude Code plugin that holds the operational rules of the JVTO content
ecosystem — answer-first editorial, evidence publishing, entity-graph integrity, and the
two-repo deploy order — as skills that create and repair, backed by checker scripts that
only report. The split is deliberate: scripts count, skills decide. The plugin guards
`jvto-ekosistem` (the content and knowledge-graph source) and `jvto-web` (the site that
renders it), and can additionally help with `jvto-platform` when that repo is present.

## Why this exists

25 npm scripts exist across `jvto-ekosistem` and `jvto-web`, and only 20 of them are wired
into CI or a deploy step. The other five run only when someone remembers to run them by
hand, which in practice means they drift.

Two of those orphans currently report false failures because the code and the policy they
inspect moved on without them. `check:fact-drift` extracts facts by pattern-matching
`FOUNDER_SCHEMA.name`, a constant that was refactored into `buildFounderSchema(facts)`, so
it now finds nothing and reports drift that isn't there. `audit:geo-visibility` freezes the
assertion `ai-train=no` in its own source, but the owner changed that policy to
`ai-train=yes` on 2026-08-18 in commit `904e8219` — the checker has been contradicting a
six-day-old decision ever since. Separately, `jvto-web/.github/workflows/ci.yml` calls
`npm run sync:trust`, a script that is not defined in that package's `package.json`; that CI
job has failed on every run since 2026-08-19.

None of these are exotic failures — they are what happens when a script's assumptions and
the codebase's reality are allowed to diverge silently. The plugin's job is to wire, guard,
and remember: wire orphaned scripts into a place they get run, guard edits with checkers
that read current policy instead of freezing it, and remember open backlog and past
decisions across sessions instead of relying on any one person's memory of why something
is the way it is.

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

*Filled in Task 7, once the skills exist.*

## Checkers

*Filled in Task 7, once the checker scripts exist.*

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
node --test test/
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

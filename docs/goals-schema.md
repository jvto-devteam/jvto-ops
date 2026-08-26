# `state/goals.json` schema

This file lives in `jvto-ekosistem` (at `state/goals.json`), not in this
plugin repo. It is project state — the running baseline, the open backlog,
and the policy decisions the owner has actually made — not plugin code, so it
does not ship with `jvto-ops` and is not created by it. `scripts/session-brief.mjs`
reads it if present; checkers may read it for policy.

## Shape

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

### `updated`
ISO date the file was last edited. A human or a skill bumps this whenever
`backlog` or `decisions` changes.

### `baseline`
The most recent live-site measurement, so a new run has something to compare
against. `measuredAt` and `tool` record how the numbers were produced;
`byPageType` mirrors the columns `audit-answer-structure.py` prints, keyed by
the same page-type names (`destination`, `crew`, `pdp`, …). Without a
recorded baseline, no later claim of "we improved density" is checkable —
there's nothing to diff against.

### `backlog`
Open and closed work items, each with an `id`, a `title`, a `status`
(`open` | `done` | any project-specific value), and `evidence` — the
concrete count or observation that justifies the item, not a restated
opinion. `session-brief.mjs` prints every entry whose `status` is `open`.

### `decisions`
The load-bearing block. Each entry is one policy decision the owner has
actually made: an `id` a checker can key off of, the `date` it took effect,
the `decision` itself in a form a checker can compare against, `why` for the
human reading it later, and `commit` — the `jvto-web` (or `jvto-ekosistem`)
commit that made it real, so the decision is traceable to code rather than
to a conversation.

## The rule this exists to enforce

**A checker must read a policy from `state/goals.json` instead of freezing
it in its own source.**

`jvto-web`'s `audit:geo-visibility` (`scripts/audit-generative-visibility.mjs`)
hardcodes its expected `Content-Signal` value as a literal in the script
itself:

```js
if (row.contentSignal !== "search=yes,ai-train=no,use=reference") {
```

On 2026-08-18, in commit `904e8219`, the owner changed the actual policy to
`ai-train=yes` — `robots.ts` already allowed every AI-training crawler, and
AEO/GEO visibility is a stated goal, so the frozen `ai-train=no` no longer
matched what the site was doing. The checker's literal wasn't updated in the
same commit, because nothing connected the two. It has since reported
**eleven false failures** across six days: correct site behavior, flagged as
a defect, because the check compared against a policy that had already
changed underneath it.

The fix is structural, not a one-time edit: a checker that would otherwise
freeze a policy constant reads it from `state/goals.json.decisions` at run
time instead. When the owner changes the policy, they update one JSON file
in `jvto-ekosistem` — the same commit that changes the behavior, or a
follow-up in the same session — and every checker that reads from it picks
up the change immediately. No checker source edit is required, and no
checker can drift out of sync with a decision it never freezes.

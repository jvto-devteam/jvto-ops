---
name: checker-hygiene
description: Write a new checker or repair one that's rotted — when the code or policy a checker inspects changes, the checker changes in the same commit, or it starts crying wolf on a policy that already moved on.
argument-hint: "[write · repair · unfreeze] [checker]"
user-invocable: true
---

## When this applies

A new checker is being written, an existing one is producing false
failures, or a policy value it depends on just changed.

## Rules

1. **When you change the code or policy a checker inspects, update the
   checker in the same commit.** Not a follow-up — the same commit, so
   nothing connects the two only by luck.
2. **A checker that would otherwise freeze a policy constant must read it
   from `state/goals.json` instead.** jvto-web's `audit:geo-visibility`
   hardcoded its expected `Content-Signal` as `ai-train=no`; the owner
   changed policy to `ai-train=yes` on 2026-08-18 in commit `904e8219`, and
   the frozen checker produced eleven false failures across six days before
   anyone noticed the checker, not the site, was wrong.
3. **Every checker ships with a fixture reproducing the defect it was
   written for.** A checker with no fixture is unverifiable and rots
   invisibly.
4. **The same failure happens on the extraction side, not just the policy
   side.** `check:fact-drift` pattern-matches `FOUNDER_SCHEMA.name`, a
   constant that was refactored into `buildFounderSchema(facts)` — it now
   finds nothing and reports drift that isn't there.
5. **Everything warns; only `check-graph-integrity` is cleared to block a
   push.** A new or repaired checker defaults to warn-only until its
   false-positive rate is proven at zero.

## Create

Write a new checker on the shared contract in `scripts/lib/repos.mjs`:
`finding(level, file, message, line?)` and `report(checker, findings, argv)`.
Keep pure logic separate from its CLI wrapper so tests exercise it with no
I/O, and ship it with a fixture reproducing the defect it targets.

## Repair

Unfreeze a checker whose hardcoded constant drifted from
`state/goals.json`. Re-point a checker whose extraction pattern no longer
matches refactored code (the `FOUNDER_SCHEMA.name` case).

## Checked by

none — judgment only. `node --test` running the fixture-backed suite is the
nearest thing to automated coverage here, not a separate checker script.

## Stops and asks

Whether a checker's false-positive rate is actually zero, before promoting
it from warn to block, is a judgment call — stop and ask before wiring a new
or repaired checker to `PreToolUse git push`. When a `state/goals.json`
policy value itself looks stale or disputed, that's a content decision, not
a checker-hygiene one — hand it to the relevant content skill instead of
hardcoding a new guess.

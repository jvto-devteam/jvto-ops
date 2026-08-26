---
name: ship
description: Run the two-repo deploy in ekosistem-then-web order and diagnose a failed gate — deploying both repos at once fails the visible-content gate on pages that are actually correct, because the build and the audit read content from two different places.
argument-hint: "[ship · diagnose · rerun] [target]"
user-invocable: true
---

## When this applies

A content or code change is ready to deploy across jvto-ekosistem and
jvto-web, or a deploy just failed and it's unclear whether that's a real
regression or an ordering problem.

## Rules

1. **ekosistem first, then wait for the content API to actually serve the
   changed route, then jvto-web.** Confirm with `curl` before proceeding —
   don't assume propagation.
2. **Never deploy both at once.** The jvto-web build fetches content over
   HTTP while its own audit reads files from disk on the VPS. Deploying
   together gets the build stale content while the audit sees fresh files,
   and the gate fails on pages that are actually correct.
3. **Never `git add -A` in a working directory shared by concurrent
   sessions** — it can stage another session's in-progress edits.
4. **Revert timestamp-only regenerated files selectively.** If a
   regeneration step touched files with no real content change (mtime/hash
   noise only), unstage or revert those individually rather than committing
   the noise.
5. **Read the log before calling a failure a flake.** A gate failure has a
   specific cause — usually the ordering/timing issue above. Re-running
   blind wastes a cycle and can mask a real regression.

## Create

A first-time deploy of a route: follow the ordering in Rule 1 end to end,
confirming the content API before triggering the jvto-web build.

## Repair

Diagnose a failed gate by reading the log for which rule was actually
broken (ordering, a `git add -A` collision, a stale mtime-only file) before
deciding to rerun. Rerun only once the actual cause is fixed, not as a first
response to a failure.

## Checked by

`scripts/check-script-wiring.mjs` — a workflow calling an npm script that
doesn't exist. jvto-web's `ci.yml` calls `npm run sync:trust`, removed from
`package.json` on 2026-08-15 in commit `1542fb08`; the last green CI run was
2026-08-11. This is exactly the silent breakage `ship` must diagnose rather
than write off as a flake.

## Stops and asks

When a gate failure could be either a real regression or the known
ekosistem/web timing mismatch, and the log doesn't clearly show which, stop
and ask rather than force a rerun or force a merge. Never skip the gate to
get a deploy through.

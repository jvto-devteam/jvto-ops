---
name: answer-first
description: Write or tighten the 40-60 word answer-first block that opens a page — the definition-plus-facts block sitting directly under the hero lede, with volatile numbers as tokens, no invented claims, and disputed facts omitted rather than guessed.
argument-hint: "[write · tighten · retoken] [page or block]"
user-invocable: true
---

## When this applies

A page's `answerFirst` (or `lede`/`summary`) block is missing, too short, too
long, reads like marketing copy, or has a hardcoded number that will go stale.
Also applies to crew answer blocks, which follow the same shape.

## Rules

1. **40-60 words.** Outside that range it's either too thin to answer or long
   enough to have become narrative again.
2. **Shape:** `[Subject] is [definition]. [Fact 1]. [Fact 2]. [Qualification].`
3. **Position:** directly under the hero lede, before any narrative section.
   Never further down the page — the position is the point.
4. **At least three quantified facts** — numbers with units, dates, official
   entity names, document/regulation numbers, specific place names, named
   people. An adjective without a measurement beside it is not a fact.
5. **No new claims.** Every fact must already exist in this repo or a document
   published on the site. The block compresses and repositions; it never
   introduces.
6. **Volatile numbers are tokens, not literals:** `{GOOGLE_RATING}`,
   `{GOOGLE_REVIEW_COUNT}`, `{PACKAGE_COUNT}`, `{PRICE_FROM}`. The Google
   review count moved 153→155 overnight while these blocks were being
   written — a literal is wrong by the next render.
7. **State the limitation where one exists** ("escort approval is not
   guaranteed," "gas conditions can close the crater floor at short
   notice"). Do not smooth it into marketing copy.
8. **When two sources disagree, omit the number and report — never guess.**
   Madakaripura is 200 m in `display_height_m` and `summary`, and "~100 m" in
   `hero_meta_override` (duplicated in a jvto-web FALLBACK). The shipped
   block states the location, the walk, and the entry fee, and stays silent
   on height.
9. **No pronouns for a person whose pronouns are not recorded** — crew blocks
   write around it ("Holds HPWKI membership credential KTA-G-2024-006").
10. **Count, don't assert.** "Named in 21 guest reviews" is computed from
    `reviews.json` `crewCodes`, not estimated.
11. **Fluff blacklist** — no standalone adjective without a measurement
    beside it (`check-answer-first` warns on this, never blocks).
12. **Verify the expression you actually write, not a debug print of it.**
    All eleven crew answer blocks once shipped with an empty KTA code because
    a generator read `kta.credentialId` while the roster stores `kta.id`; the
    debug print used a fallback chain that included `id`, so the printout
    looked right while the write was empty. `check-answer-first` caught it on
    its first run against the real repo — trust what the checker reads from
    the file over what a print statement showed.

## Create

Draft the block in `meta.answerFirst` on the page's `.source.json`, or a
top-level `answerFirst` for `destination-knowledge/*.content.json`. Lead with
the three facts that answer the page's type: proof (evidence volume, class,
how to verify), destination (elevation, trailhead, duration, permit, season),
crew (role, employed vs. freelance, credential ID, review count), regulatory
(the rule, its authority, its number and date), commercial (itinerary count,
duration range, what "private" means, price floor), policy (deposit,
deadline, remedy).

## Repair

Tighten a block that fails word count or fact density. Retoken a block that
hardcodes a volatile number — replace with `{GOOGLE_RATING}` /
`{GOOGLE_REVIEW_COUNT}` / `{PACKAGE_COUNT}` / `{PRICE_FROM}` and confirm
`applyLiveNumbers` fills it at render.

## Checked by

`scripts/check-answer-first.mjs` — word count 40-60 (error), fewer than three
quantified facts (error), fluff-blacklist adjective (warning), volatile
number written as a literal where a token exists (error). Wired to
`PostToolUse` on `*.source.json` / `*.content.json` edits under
`1-knowledge-and-evidence-core`.

## Stops and asks

When two sources disagree on a fact (the Madakaripura height case), omit the
number and report the conflict — never pick a side. When a fact isn't
already written down anywhere in the repo or a published document, do not
invent it into the block; ask where it should be sourced first.

---
name: crew
description: Add a crew member to the roster, backfill review attribution by union rather than replacement, or register an alias form — an ambiguous alias always gets a manual tag, never an automatic rule.
argument-hint: "[add · attribute · alias] [crew member]"
user-invocable: true
---

## When this applies

A new crew member joins the roster, guest-review attribution needs
backfilling, or a crew member's name appears in a form the roster doesn't
already index.

## Rules

1. **Union, never replace, when backfilling.** New attributions are added to
   what's already recorded, never used to overwrite it.
2. **Index the roster under every name form a person is known by.** An alias
   rule keyed on `Boy` silently dropped `Boy (Ahboy)` — indexing only the
   bare form lost the parenthetical alias entirely.
3. **An ambiguous alias gets a manual per-review tag, never an automatic
   rule.** Review #287's "Driver Joy" is still untagged — an automatic rule
   would have guessed, right or wrong, and a wrong guess is a silent
   misattribution. It stays a manual decision point instead.

## Create

Add a new crew member: role, employed vs. freelance status, credential ID,
and every known name/alias form indexed against the roster.

## Repair

Attribute: backfill review attribution to a crew member by unioning new
`crewCodes` matches into what's already recorded, never replacing it.
Alias: register a new alias form so the person is found under every name
they're credited by.

## Checked by

`scripts/check-answer-first.mjs` applies to crew answer blocks (same
word-count and fact-count rules as any other answer-first block — word
count is an error, fact count a warning; see `answer-first`'s Checked by
section). The no-pronoun rule (answer-first rule 9) is real but not
mechanically enforced by that checker — it has no pronoun check at all;
following it is judgment only, same as alias indexing and attribution
union.

## Stops and asks

An ambiguous alias (which real person "Driver Joy" refers to) is never
resolved automatically — tag it manually or leave it open and ask. When a
generated answer block's credential field comes up empty, verify the actual
written expression against the roster field name, not a debug print with a
permissive fallback chain: all eleven crew answer blocks once shipped with an
empty KTA code because a generator read `kta.credentialId` while the roster
stores `kta.id`, and the debug print's fallback chain included `id`, so the
printout looked right while the write was empty. Trust what
`check-answer-first` reads from the shipped file over what a print statement
showed.

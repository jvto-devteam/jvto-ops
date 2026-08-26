---
name: measure
description: Take a live-site measurement baseline with the standalone Python auditor (audit-answer-structure.py, not one of the Node repos.mjs checkers) before an editorial change and compare against it after, using a measurer that's been validated on a case whose answer is already known — not trusted on its first run.
argument-hint: "[baseline · compare · validate] [pages or metric]"
user-invocable: true
---

## When this applies

An editorial or structural change is about to happen (or just happened) and
someone wants to claim it improved fact density or answer structure across
the live site.

## Rules

1. **Baseline before, same tool after.** A claim of improvement isn't
   checkable without a prior measurement taken with the identical tool.
2. **Validate the measurer on a case whose answer is already known before
   trusting its output broadly.** The auditor's first version stripped
   `<header>`, which is the page hero on most routes here, discarding the
   exact answer block being measured; its second version read only `<p>`,
   missing the answer block that renders as a `<div>`. Both passed casual
   review before being checked against a known-answer page.
3. **Encode judgment calls in the tool, not in memory.** "Don't strip
   `<header>`" and "don't treat low fact density on crew pages as a defect"
   (crew pages are built from verbatim guest reviews, the highest-uplift
   method in the underlying study) are written into
   `audit-answer-structure.py` itself so they survive the next person who
   runs it.

## Create

Establish a new baseline entry in jvto-ekosistem's `state/goals.json`:
`measuredAt`, `tool`, and `byPageType` numbers from a real run.

## Repair

Re-validate the measurer itself whenever a page template's markup shape
changes — rerun it against a known-answer page before trusting a comparison
built on it.

## Checked by

`scripts/audit-answer-structure.py` — live-site fact density and answer
structure. Manual or weekly only; never wired to a hook, since it hits the
live site rather than local files.

## Stops and asks

When the tool's output disagrees with a manual read of a page (it reports
zero facts on a page that clearly has some), stop and fix or re-validate the
tool rather than trust either number. Don't report an "improvement" figure
until the measurer has itself been checked against a known case.

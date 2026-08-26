---
name: evidence
description: Publish a document with a SHA-256 hash tested against the file on disk, or correct an evidenceStatus after actually checking the file — never stamping verified on something nobody opened.
argument-hint: "[publish · rehash · reclassify] [document]"
user-invocable: true
---

## When this applies

A document is being published to the proof library, or its `evidenceStatus`
needs correcting after a recheck.

## Rules

1. **SHA-256 for every published document**, computed and tested against the
   actual file on disk — never copied from elsewhere or asserted.
2. **`evidenceStatus` is `verified`, `candidate`, or `media_sourced` —
   never a guess.**
3. **Stamp only what was actually checked.** A verification script once
   stamped 44 assets it never opened as verified; a proper check afterward
   found 13 stale hashes among them.
4. **When the document is not held**, say so — `media_sourced` exists for a
   claim cited from the press or a public registry lookup rather than a file
   in hand. Do not imply possession.

## Create

Publish a new document: compute its hash, confirm the hash matches the file
that will actually ship, and set `evidenceStatus` to what was genuinely
checked — not to `verified` by default.

## Repair

Rehash a document after it changes or is re-saved — never carry forward the
old hash. Reclassify `evidenceStatus` only after the document has actually
been reopened and matched, not on the strength of a prior stamp.

## Checked by

none — judgment only. No script in this plugin computes or verifies hashes;
the discipline is the skill, and the incident above (44 unopened stamps) is
exactly what automating trust in this step produces without one.

## Stops and asks

When the file can't be located to hash it, stop rather than reuse a prior
hash or a hash from a similar document. When `evidenceStatus` is disputed
between two sources, report the conflict — don't average or pick one.

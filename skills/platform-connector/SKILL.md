---
name: platform-connector
description: Implement or audit a jvto-platform connector that reads from jvto-ekosistem without becoming a third source of truth — every record stamped with its source and read time, marked stale when the source changes underneath it.
argument-hint: "[implement · audit] [connector]"
user-invocable: true
---

## When this applies

jvto-platform needs to read content or graph data that jvto-ekosistem
already owns, or an existing connector needs checking against drift.

## Rules

*Observations below verified against `sambuko82/jvto-platform` at commit
`1af424b`.*

1. **The connector reads, it does not own.** jvto-platform never becomes an
   independent source of truth for content ekosistem already owns.
2. **Every record stores its source and read time**, so staleness is
   checkable rather than assumed.
3. **When the source changes, the copy is marked stale — not quietly
   kept.** A connector must never silently keep serving outdated data as if
   it were current.
4. **The current connector is a stub.** It returns a fixed
   `{"source": "jvto-ekosistem", "status": "ready_for_sync"}` and touches
   nothing — no real read, no staleness tracking, yet.

## Create

Implement a connector that actually reads from ekosistem (via its content
API or a file read, following the same sibling-checkout convention this
plugin uses), stamps source and read time on every record, and marks
records stale when the underlying source changes.

## Repair

Audit an existing connector against the rules above: does it actually read,
or return a stub; does every record carry source and read-time; is
staleness tracked and acted on.

## Checked by

none — judgment only. No script in this plugin inspects jvto-platform.

## Stops and asks

When it's unclear whether a piece of data belongs in jvto-platform at all,
versus staying owned by ekosistem and only referenced, stop and ask.
Building it into the connector regardless is exactly how a third source of
truth starts. And when ekosistem and a cached or already-synced record
disagree on a fact, this skill does not decide which is right — mark the
record stale and report the conflict, the same disputed-fact limit every
skill in this plugin carries.

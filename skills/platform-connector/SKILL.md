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

*Observations below re-verified against `sambuko82/jvto-platform` at commit
`1af424b` on 2026-08-27, still that repo's HEAD. It is a pnpm/Turbo
monorepo: the connector layer is
`apps/backend/app/integrations/connectors/`, not `app/...`.*

1. **The connector reads, it does not own.** jvto-platform never becomes an
   independent source of truth for content ekosistem already owns.
2. **Every record stores its source and read time**, so staleness is
   checkable rather than assumed.
3. **When the source changes, the copy is marked stale — not quietly
   kept.** A connector must never silently keep serving outdated data as if
   it were current.
4. **The connector layer does not import.** Read this before planning any
   work against it: `jvto_ecosystem_connector.py`, `llm_wiki_connector.py`,
   `nocodb_connector.py` and `integrations/source_registry.py` all open with
   `from app.integrations.connectors.base_connector import
   SourceConnectorBase`, and **`base_connector.py` does not exist anywhere
   in the repo** — there is no `__init__.py` in `connectors/` either.
   Importing any of the four raises `ModuleNotFoundError`. So the first task
   is not writing a real read; it is defining the base class the whole layer
   already codes against, and deciding there whether source and read-time
   stamping (rule 2) and staleness (rule 3) live in the base or in each
   connector.

   Once it imports: `JVTOEcosystemConnector.fetch_raw()` returns a fixed
   `{"source": "jvto-ekosistem", "status": "ready_for_sync"}` and touches
   nothing, and `normalize()` passes that through under `source_repo` /
   `source_owner` with no read time. So even repaired, it is a stub — no
   real read, no staleness tracking.

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

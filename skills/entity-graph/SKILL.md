---
name: entity-graph
description: Add an organisation or person to the entity registry, link or dedupe references between registry entries, or close a dangling @id — the one integrity check cleared to block a git push.
argument-hint: "[add · link · dedupe · repair] [entity or @id]"
user-invocable: true
---

## When this applies

A new organisation, government body, or person needs a registry node; two
registry entries need a relation; a document has an inline node duplicating
one already in the registry; or a push is blocked on a dangling `@id`.

## Rules

1. **Every referenced `@id` must be defined somewhere.** A dangling
   reference is an error, not a warning — this is the one check cleared to
   block `git push`.
2. **One real-world entity is one node.** Never an inline duplicate of a
   registry entry — POLPAR written inline beside a registry node for the
   same unit is exactly the failure this rule exists to prevent.
3. **Relations between two registry entries are edges, not prose.** Link
   them structurally (e.g. `recognizedBy`, `memberOf`); don't restate the
   relation as free text next to either node.
4. **Never reference an asset that is deliberately not published.** An `@id`
   pointing at something intentionally unpublished is still dangling —
   remove the reference, or if jvto-web legitimately builds and merges that
   node at render time, add a reviewed entry to
   `scripts/consumer-defined-ids.json` instead of leaving a live reference
   with nothing behind it.
5. **`recognizedBy` names the actual issuer, read from the document** — not
   a guess, and not the most prominent name on it (the same regulator/issuer
   split `claim-restraint` enforces).

## Create

Add a new node with a stable `@id`; wire edges from any document that
already cites it.

## Repair

Link two existing entries via the correct edge predicate instead of
duplicating one inline. Dedupe an inline node into a reference to its
canonical `@id`. Close a dangling `@id` by defining the missing node, or, if
it's genuinely built by jvto-web at render time, add a reviewed exemption to
`scripts/consumer-defined-ids.json` — `ids` for one stable node (e.g. the
founder), `patterns` + `onlyUnderPredicates` for a route-shaped class (e.g.
tour-PDP `#webpage` nodes). Never blanket-exempt an id under every
predicate.

## Checked by

`scripts/check-graph-integrity.mjs` — dangling `@id`s and inline nodes
duplicating a registry entry. Offline mode reads ekosistem's
`*.schema-output.json`; `--live` fetches the sitemap and merges in
jvto-web-built nodes. Wired to `PreToolUse` on `git push` — the only checker
in this plugin allowed to fail that hook.

## Stops and asks

When it's unclear whether a jvto-web-built node belongs in
`consumer-defined-ids.json` or is a genuine gap in ekosistem, stop and ask —
misclassifying it defeats the one check allowed to block a push. When two
registry entries disagree about who `recognizedBy` names, report the
conflict rather than guessing.

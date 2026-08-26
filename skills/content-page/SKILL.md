---
name: content-page
description: Create a content page end to end in jvto-ekosistem, or reclaim prose that drifted into jvto-web back to the source of truth — including the local-build step that makes a new block silently invisible if skipped.
argument-hint: "[new · reclaim · retire] [page or route]"
user-invocable: true
---

## When this applies

A page needs to be created from scratch, prose found assembled inline in a
jvto-web `.tsx` needs to move back to ekosistem, or a page/route is being
retired and its content and graph edges need to go with it.

## Rules

1. **Write to the SSOT, never to jvto-web.** Content lives in the page's
   `.source.json` (or `destination-knowledge/*.content.json`), never
   assembled as prose inside a jvto-web consumer component.
2. **The eight shipping steps, in order** — skipping or reordering these is
   how a deploy fails:
   1. Write to the SSOT.
   2. Render (`npm run render:web-content`) and confirm the field lands at
      `/page/<field>` in the route's `.website-output.json`. If it isn't in
      `meta`, nothing downstream finds it.
   3. **Build against the LOCAL ekosistem, or you are testing nothing.**
      `.env` sets `JVTO_EKOSYSTEM_CONTENT_BASE_URL` to the *deployed* content
      API, so a plain `npm run build` reads content that doesn't have your
      change yet — the new block silently fails to render, no error thrown.
      Force the local read:
      ```
      JVTO_EKOSYSTEM_CONTENT_BASE_URL= \
      JVTO_EKOSYSTEM_CONTENT_ROOT=/absolute/path/to/jvto-ekosistem \
      npm run build
      ```
   4. Run the visible-content gate (`npm run audit:ecosystem-visible-content`)
      against the local root. Content nothing renders fails the build — the
      gate working, not a nuisance.
   5. Deploy ekosistem first.
   6. Wait for the content API to serve the changed route — confirm with
      `curl`, don't assume propagation.
   7. Deploy jvto-web.
   8. Verify on the live site with `curl`, not a local build — a local build
      only proves the code path.
3. **Reclaiming** means replacing an assembled/spliced expression in the
   `.tsx` with a plain read of the SSOT field — not rewriting the prose from
   memory, moving the exact content back.

## Create

New page: write the source JSON, follow all eight steps above end to end.

## Repair

Reclaim: move prose `check-ssot-drift` flagged as assembled in jvto-web back
into the ekosistem SSOT field it should have been read from, then re-render.
Retire: remove the page's content and rendered output, and check
`entity-graph` for edges that referenced it before deleting the node.

## Checked by

`scripts/check-ssot-drift.mjs` — prose assembled in a jvto-web consumer file
instead of read from ekosistem. `scripts/check-answer-first.mjs` if the page
carries an answer-first block. jvto-ekosistem's own
`npm run audit:ecosystem-visible-content` (not part of this plugin) gates
step 4.

## Stops and asks

When the jvto-web copy and the ekosistem SSOT disagree on a fact during a
reclaim, stop — same rule as `answer-first`: report the conflict, don't pick
a side. When retiring a page whose content is still referenced by an entity
graph edge, stop and resolve the graph reference first rather than leaving a
dangling `@id`.

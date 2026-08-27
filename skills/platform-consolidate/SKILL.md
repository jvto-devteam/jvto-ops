---
name: platform-consolidate
description: Reconcile jvto-platform's duplicated scaffolding — two directories of identically named files, routes never registered in the router, a stray final_-prefixed model, and no tests — before adding anything new to it.
argument-hint: "[merge · register · test] [module or route]"
user-invocable: true
---

## When this applies

Work is about to touch jvto-platform's module/service layer, its router, or
its DB models, and the existing scaffolding is duplicated or dangling enough
that adding to it blindly would extend the mess.

## Rules

*Observations below re-verified against `sambuko82/jvto-platform` at commit
`1af424b` on 2026-08-27, which is still that repo's HEAD. Paths corrected in
the same pass: it is a pnpm/Turbo monorepo, so everything lives under
`apps/backend/`, and the earlier `app/...` paths in this skill resolved to
nothing.*

1. **`apps/backend/app/modules/` and `apps/backend/app/services/` carry
   eight identically named files, each in exactly two copies —
   `citation_service.py`, `claim_service.py`, `pricing_service.py`,
   `product_service.py`, `quotation_service.py`, `readiness_service.py`,
   `website_compiler.py`, `wiki_service.py`.** Both trees are split by
   domain subdirectory, and the two do not always agree on the domain:
   `modules/operations/readiness_service.py` against
   `services/ops/readiness_service.py`. Confirm which copy the API layer
   imports before deleting either — the `modules/` copies look live.
2. **10 of the 15 route modules in `apps/backend/app/api/v1/routes/` are
   registered in `apps/backend/app/api/v1/router.py`.** Registered:
   artifacts, auth, bookings, claims, health, jobs, operations, products,
   sources, wiki. Implemented but unreachable: **admin, audit, ops_admin,
   reporting, system** — the same shape as the orphaned-script problem this
   plugin solves in ekosistem and web. (This entry read "10 of 16" before
   2026-08-27; the sixteenth was `__init__.py`.)
3. **`apps/backend/app/db/` holds six modules, four of them models —
   `models.py`, `audit_models.py`, `security_models.py`, and
   `final_models.py`.** The `final_` prefix signals an unresolved merge or
   decision, not a real model name.
4. **There are no tests.** Not one path in the tree contains `test`. Any
   consolidation here has no safety net; write the test before or alongside
   the merge, never after.

## Create

Register a route module that's implemented but missing from the router.
Add the first test covering a module before merging its duplicate away.

## Repair

Merge a `modules/` vs. `services/` duplicate pair down to the one the API
layer actually imports, deleting the dead copy only after confirming
nothing else references it.

## Checked by

none — judgment only. jvto-platform has no checker script in this plugin;
consolidation here is manual until connector-grade tooling exists for it.

## Stops and asks

When it's unclear which of two identically named files is the one to keep,
check what the API layer actually imports before deleting either (and note the two trees disagree on domain folders, so a name match is not a path match) — if
that's ambiguous too, stop and ask rather than guess which copy is
"correct." Renaming or deleting the `final_`-prefixed model without knowing
which merge it resolves is the same kind of guess — ask first. And when the
`modules/` and `services/` copies of a same-named file turn out to disagree
in behavior, not just duplicate each other in name, that is a disputed fact
about which output is correct — report it and don't decide without the
route owner confirming, the same disputed-fact limit every skill in this
plugin carries.

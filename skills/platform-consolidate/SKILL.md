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

*Observations below verified against `sambuko82/jvto-platform` at commit
`1af424b`.*

1. **`app/modules/` and `app/services/` carry eight identically named
   files — `citation_service.py`, `claim_service.py`, `pricing_service.py`,
   `product_service.py`, `quotation_service.py`, `readiness_service.py`,
   `website_compiler.py`, `wiki_service.py` — and only `services/` is
   imported by the API layer.** The `modules/` copies are dead weight that
   looks live.
2. **10 of 16 route modules are registered in `app/api/v1/router.py`** —
   six exist but are unreachable, the same shape as the orphaned-script
   problem this plugin solves in ekosistem and web.
3. **Four DB model files exist, including one prefixed `final_`** — a
   naming pattern that signals an unresolved merge or decision, not a real
   model name.
4. **There are no tests.** Any consolidation here has no safety net; write
   the test before or alongside the merge, never after.

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
check what the API layer actually imports before deleting either — if
that's ambiguous too, stop and ask rather than guess which copy is
"correct." Renaming or deleting the `final_`-prefixed model without knowing
which merge it resolves is the same kind of guess — ask first. And when the
`modules/` and `services/` copies of a same-named file turn out to disagree
in behavior, not just duplicate each other in name, that is a disputed fact
about which output is correct — report it and don't decide without the
route owner confirming, the same disputed-fact limit every skill in this
plugin carries.

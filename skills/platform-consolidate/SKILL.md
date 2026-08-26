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

1. **`app/modules/` and `app/services/` carry eight identically named
   files, and only `services/` is imported by the API layer.** The
   `modules/` copies are dead weight that looks live.
2. **Six of sixteen route modules are never registered in the router** —
   code that exists but is unreachable, the same shape as the orphaned-script
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
which merge it resolves is the same kind of guess — ask first.

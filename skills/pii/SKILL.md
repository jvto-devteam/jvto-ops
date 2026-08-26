---
name: pii
description: Redact personally identifying data from a document before publication, or reverify one already published — true pixel-level redaction confirmed by sampling the extracted image, not the rendered page, and checked against derivatives too.
argument-hint: "[redact · reverify] [document]"
user-invocable: true
---

## When this applies

A document about to be published (or already published) carries a NIK,
signature, phone number, or other personal identifier that must not be
public.

## Rules

1. **True redaction scrubs pixels.** Not a black box drawn over text that is
   still selectable or extractable underneath.
2. **Verify by sampling the extracted image, not the rendered page.** A
   rendered page can look redacted while the underlying asset still carries
   the data.
3. **Rehash afterward.** A redacted document is a changed file — its
   SHA-256 must be recomputed (see the `evidence` skill).
4. **Check derivatives, not only the primary asset.** Three preview images
   once carried NIK numbers that the audit list had missed entirely — a
   redaction pass on the primary document doesn't automatically reach
   thumbnails or previews generated from it.

## Create

When publishing a new document, redact known PII fields before first
publication — never publish first and redact after.

## Repair

Redact a document already published with PII exposed. Reverify a
previously-redacted document, including every derivative (thumbnail,
preview, cached render), after a leak is found in any one of them.

## Checked by

none — judgment only. Verification here is a human sampling the extracted
image; no script in this plugin scans for PII.

## Stops and asks

When it's unclear whether a value is PII (a person's private identifier
versus a public document or registration number), stop and ask rather than
assume. Over-redacting a public document number destroys evidence;
under-redacting leaks PII — this call is not automatable.

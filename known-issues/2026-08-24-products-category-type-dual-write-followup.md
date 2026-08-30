# Products category/type dual-write — deliberate follow-up, not forgotten

**This is a bridge, not the destination.** Recorded here explicitly so it doesn't take six months
to rediscover.

## What's live now (this PR)

`product-form.tsx`'s two dropdowns write **both** pairs on every selection:
- Product Type: `product_type_id` (the real FK, the dropdown's own value) **and** `product_type`
  (the matching name, looked up from the same `productTypes` list the dropdown renders from — not
  a separate guess).
- Product Category: `product_category_id` **and** `category_id` (a direct id copy — both are FKs
  to the literal same `product_categories` table, migration 010 and migration 067 respectively, so
  they cannot disagree once both are set this way).

This closes the immediate bug (new products silently getting `category_id`/`product_type = NULL`
because only the newer pair was ever written) without needing a backfill or any read-side
migration — see `known-issues/2026-08-24-products-category-type-split-report.md` for why: 97-98%
of existing products already carry their real category/type on the **legacy** columns, which is
what every current read site (products list, product detail, `resolveJobDepartments`) already
reads.

## Why this is not the end state

Two columns holding the same fact is exactly what produced this bug in the first place — migration
067 added `product_type_id`/`product_category_id` as the intended-real FK pair, the product form
was pointed at writing only that pair, and nothing else in the app ever got moved onto reading it.
The dual-write makes both pairs agree going forward, but the underlying problem — a second FK to
the same table, a second free-text-vs-FK pair for the same concept — is still there, and it already
caused one other real bug independently: the products list's `product_categories` embed was
ambiguous between the two FKs and PostgREST refused it outright (`PGRST201`), which is what left
the entire products list showing no category for any product until this same PR added an explicit
FK hint. That class of bug — an unqualified embed anywhere in the app silently choosing wrong, or
refusing outright, because two FKs point at the same table — can recur anywhere a future query
embeds `product_categories` without naming the FK, for as long as both columns exist.

## The actual fix, deliberately not done here

Collapse to one column per concept:
1. Pick the surviving column for each pair. Given the live-data split found in the investigation
   report (legacy columns hold 97-98% of real data; every current read site already uses them),
   the legacy pair (`category_id`, `product_type`) is the more likely survivor for *category* by
   default — but `product_type_id` is a real FK against a real `product_types` table with its own
   managed settings screen, versus `product_type` being free `text` with no referential integrity
   at all, so *type* deserves a genuine decision, not an assumption in either direction.
2. Migrate every read site (products list, product detail, `resolveJobDepartments`, the two
   settings-page delete-guard/usage-count queries) onto the surviving column.
3. Backfill the loser's data onto the survivor for any row where only the loser is populated —
   the category direction is a safe, mechanical id copy (852 products, confirmed in the
   investigation report); the type direction needs a human decision for the 5 of 14 distinct
   `product_type` text values that don't exactly match any `product_types.name` (also enumerated
   in that report).
4. Drop the losing column and its FK constraint.
5. Remove the dual-write in `product-form.tsx` added by this PR — it becomes dead weight the
   moment there's only one column left to write.

Not scoped into this PR on purpose — it's a schema change (`DROP COLUMN`) with its own blast
radius and its own migration, and the urgent problem (new products losing their category/type,
and the products list showing none at all) is fully closed without it. Tracked here so the
dual-write doesn't quietly become permanent by nobody ever coming back to finish it.

# 2026-08-19 — product_option_rates duplicates product_default_items and double-charges labor/machine on 558 live products

## Status

**Investigation only, reported per Ruben's request — nothing changed except this doc and a
stale comment fix on migration 150.** This blocks Ruben's ~50-simplified-product build; do not
start that build until (d) below is decided. Follow-up to
`known-issues/2026-08-19-pricing-tables-product-option-rates-vs-default-items.md`, which
established that both tables price — this doc quantifies what that actually costs in practice.

**Correction to that earlier doc:** migration 150 (the `product_option_rates` RLS policy) **is
live** — Ruben ran it and verified via `pg_policies` ("org members can manage product option
rates", FOR ALL). Its header comment said "PENDING" and was never updated after the policy
was actually applied; fixed in this commit. **The data-loss risk that doc flagged (a Migrate
save silently wiping option-rate rows because the page couldn't see them) is closed** — the
page can see existing rows now, so a save no longer resubmits an empty array.

## a) Priced Banner Regular- Single Sided up to 5ft live (H=48, W=96, Qty=1) via the real path

Ran `calculateProductPrice()` (`src/lib/pricing/formula-engine.ts`) directly — the actual
function every quote line item goes through, not a reimplementation.

**Yes, labor is being counted twice — completely, not partially.** All 10
`product_option_rates` rows for this product carry the **exact same `rate_id`** as a row
already in the product's own `product_default_items`:

| Table | Rows | Sum (cost, cents) |
|---|---|---|
| `product_default_items` (recipe) | 16 | 14,801 |
| `product_option_rates` (option rates) | 10 | 12,067 |
| **Total cost** (what actually drives the price) | | **26,868** |

`totalCostCents` (26,868) × markup (2×) = `unit_price_cents` **53,736** ($537.36). Every one of
the 10 option-rate rows is a rate ALSO present in the recipe — Prepress, Zund Prep, Printing
Labor, Hemtek Prep, Hemming Labor (the `Perimeter`-formula variant specifically — the recipe
also has `Height` and `Width` variants of Hemming Labor that are NOT duplicated), Pole Pocket
Labor, Hemtek Pole Pocket Prep, Assembly, Zund Cutting Labor, Zund Cutting Machine. Without the
option-rates duplication, cost would be 14,801 → price **$296.02** — the option-rates table is
inflating this specific product's price by **~81.5%**.

(Separately, and not the main finding here: the recipe itself already has "Zund Cutting Labor"
and "Zund Cutting Machine" each appearing twice with identical cost/formula — worth a look, but
distinct from the default_items-vs-option_rates duplication this doc is about.)

## b) Scale: 558 live products, not an isolated hand-edit

**My earlier "119 of 887 products (~13%)" figure in the prior doc was wrong** — it came from an
unpaginated `.select('product_id')` query that silently truncated at PostgREST's 1000-row
default limit (5,903 total `product_option_rates` rows, only the first 1,000 were read). Redid
it paginated through all 5,903 rows:

- **625 of 887 products (70.5% of the entire catalog)** have `product_option_rates` rows.
- **Every single one of the 5,903 rows, across all 625 products (100%)**, has a `rate_id` that
  exactly matches a row already in that same product's `product_default_items` — not "heavy
  overlap," total overlap. There is no product in the DB where `product_option_rates` contains
  a genuinely additional rate not already in the recipe.
- Of those 625: **604 are `migration_status = 'in_progress'`, 21 are `printos_ready`.**
- **`migration_status` does not gate pricing or quote selection** — confirmed the quote
  line-item picker (`quotes/[id]/page.tsx`) filters only on `active = true`, not
  `migration_status`, and `calculateProductPrice()` never checks `migration_status` either. So
  "in_progress" is a Migrate-page workflow label only, not a "not live yet" guarantee.
- **558 of the 625 affected products are `active = true`** — selectable and prices computed
  this way on a real quote **right now**, in production, today. This is not a hand-edit
  edge case; it's the majority of the active catalog.

This is a live over-pricing bug affecting most of the catalog, not something isolated to
products someone hand-edited on the Migrate page.

## c) Where Banner Regular's 10 rows came from — a script, not hand-editing

**Not Ruben manually building on the Migrate page.** Both the `product_default_items` insert
and the `product_option_rates` insert for this product are timestamped 2026-08-11T03:41:44 UTC,
147ms apart — and the code that ran is identifiable: `src/app/api/products/bulk-import-shopvox/route.ts`
(lines 197-273), the bulk ShopVOX-recipe importer. Its own header comment states the design
intent explicitly:

> *"product_default_items — ALL items (Material + LaborRate + MachineRate) regardless of
> catalog match... Labor/machine ALSO write to product_option_rates so the per-product migrate
> UI's labor/machine sections stay populated."*

This is a **deliberate double-write**, not a bug in the importer's own logic — whoever built it
knew the Migrate page's Labor/Machine sections read from `product_option_rates` (per the prior
doc's finding (c)) and, reasonably at the time, assumed that table was purely a UI-display
mirror. What they didn't account for (or it changed after `formula-engine.ts` was written) is
that `product_option_rates` is **also** independently summed into the price — so the "keep the
UI populated" mirror became a silent price duplicator. `products.updated_by` on Banner Regular
is Ruben's user id, consistent with him (or someone using his session) having triggered the
bulk import for this product — via `bulk-import-shopvox-button.tsx`, a real UI button that
calls this route, not manual field-by-field editing.

## d) What happens if Ruben rebuilds in /edit — and what to do about it

**`/edit` does not touch `product_option_rates` at all** (confirmed in the prior doc — no
reference anywhere in `.../products/[id]/edit/` or its shared `product-form.tsx`). That means:
if Ruben rebuilds one of the 625 affected products through `/edit`, his new clean
`product_default_items` rows go in, but **any pre-existing `product_option_rates` rows for that
product are left completely untouched** — `calculateProductPrice()` will keep summing them on
top of his rebuild, unconditionally, regardless of which editor was used. **Building in `/edit`
alone does not fix this for a product that already has option-rate rows — it silently
continues the exact same double-counting on his rebuilt product**, and there'd be no UI
anywhere (neither `/edit` nor the quote builder) that would show him why the price looks wrong.

Three options, in order of how much they fix:

1. **Minimum (unblocks the 50-product build only):** before/when Ruben opens each of his ~50
   products in `/edit` to rebuild it, delete that product's `product_option_rates` rows first.
   Scoped, safe, but leaves the other ~575 affected products (508 of them still active) silently
   over-pricing every quote that uses them.
2. **Recommended: clear `product_option_rates` for all 625 affected products now**, independent
   of the 50-product build. Given (a)-(c) — every row is a proven exact duplicate, the "sales
   rep choice at quote time" feature it was named for was never built (prior doc, finding b),
   and its one real remaining function (populating the Migrate page's Labor/Machine display)
   only matters for products still being migrated through that page — clearing the table stops
   558 live products from over-pricing customers today, not just the ones Ruben happens to
   touch. This is a straight `DELETE`, reversible only via re-running the bulk importer, so
   worth Ruben's explicit sign-off before it happens, but there's no case found in this
   investigation where a row in this table was doing anything a `product_default_items` row
   wasn't already doing.
3. **Root cause, for whoever picks this up next:** fix `bulk-import-shopvox/route.ts` to stop
   the double-write (option 2 above doesn't prevent it from happening again on the next bulk
   import run), and/or change the Migrate page's Labor/Machine sections to read from
   `product_default_items` the same way its Materials section already does — which would make
   `product_option_rates` unnecessary for the Migrate page too, not just for `/edit`.

None of this was executed — reported per the instruction to investigate only.

## Related

- `known-issues/2026-08-19-pricing-tables-product-option-rates-vs-default-items.md` — the prior
  doc this one corrects the product-count figure in and follows up on.
- `src/lib/pricing/formula-engine.ts` — both pricing loops (lines 93-97/178-265 for
  `product_default_items`, 283-287/319-381 for `product_option_rates`).
- `src/app/api/products/bulk-import-shopvox/route.ts` (lines 197-273) — the double-write, with
  its own comment explaining the (mistaken) design intent.
- `src/app/(dashboard)/dashboard/[slug]/products/bulk-import-shopvox-button.tsx` — the UI
  trigger for that route.
- `supabase/migrations/150_product_option_rates_rls_policy.sql` — header comment corrected in
  this commit; policy itself confirmed live, not pending.

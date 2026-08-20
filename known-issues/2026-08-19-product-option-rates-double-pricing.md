# 2026-08-19 — product_option_rates duplicates product_default_items and double-charges labor/machine on 558 live products

## Status

**Pricing bug FIXED (2026-08-20) — the 5,903 rows themselves are untouched, that's a separate,
still-open decision (see bottom of this doc).** Originally investigation-only; the finding
below was severe and reversible enough (a code change, not data deletion) that Ruben asked for
the fix to ship ahead of deciding what to do with the underlying rows. Follow-up to
`known-issues/2026-08-19-pricing-tables-product-option-rates-vs-default-items.md`, which
established that both tables price — this doc quantifies what that actually cost in practice
and fixes it.

**What shipped, in order:**
1. Full backup of all 5,903 `product_option_rates` rows to
   `backups/2026-08-20T00-31-39Z-product_option_rates.json` before anything else changed.
2. Confirmed 0 of those 5,903 rows have `modifier_formula` set — see "Before touching
   anything" below for why that mattered.
3. `formula-engine.ts` no longer reads or prices `product_option_rates` at all — reversible,
   one code change, corrects all 625 affected products at once, no data destroyed.
4. Re-verified Banner Regular through the real pricing path: **$296.02**, exactly the
   predicted un-duplicated price.
5. Re-verified 5 more affected products spanning different product types — see results below.
6. Fixed the cause: `bulk-import-shopvox/route.ts` no longer writes to `product_option_rates`
   either (it's dead data now that nothing reads it).
7. The 5,903 existing rows are NOT deleted — that's called out as a separate decision, not
   bundled into this fix.

**Correction to that earlier doc:** migration 150 (the `product_option_rates` RLS policy) **is
live** — Ruben ran it and verified via `pg_policies` ("org members can manage product option
rates", FOR ALL). Its header comment said "PENDING" and was never updated after the policy
was actually applied; fixed in this commit. **The data-loss risk that doc flagged (a Migrate
save silently wiping option-rate rows because the page couldn't see them) is closed** — the
page can see existing rows now, so a save no longer resubmits an empty array.

## Before touching anything: backup + the modifier_formula question

**Backup:** `backups/2026-08-20T00-31-39Z-product_option_rates.json` — full paginated export
(past PostgREST's 1000-row default, same trap that caused the earlier miscount below) of all
5,903 `product_option_rates` rows, taken via service role immediately before any code changed.
This is the reversible source of truth if any row ever needs restoring or migrating into
`product_default_items`.

**modifier_formula: 0 of 5,903 rows have it set (non-null, non-empty).** This was the question
that determined whether removing the pricing loop was a pure no-op or would silently drop real
behavior — a row with `modifier_formula` set gates itself on/off by a product modifier's value
at quote time, which its `product_default_items` twin can't do (that table's own
`modifier_formula` column is never read by the recipe loop — established in the prior doc).
With zero rows using it, **every single row in this table is doing nothing that its
default_items twin doesn't already do** — confirmed by the same export script that produced the
backup. This is what made stopping the pricing loop (below) a correction, not a feature
removal.

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

## d) What happens if Ruben rebuilds in /edit — original concern, now moot for pricing

**`/edit` still does not touch `product_option_rates` at all** — but that no longer matters for
pricing correctness, because nothing prices `product_option_rates` anymore (below). Before the
fix, this section warned that rebuilding a product in `/edit` would silently continue
double-counting on top of the rebuild, since `/edit` never clears the old option-rate rows.
That specific risk is closed by the pricing fix — a rebuilt product's price is now driven
entirely by whatever's in `product_default_items`, regardless of what stale
`product_option_rates` rows still exist for it. (Its Migrate-page Labor/Machine columns may
still look wrong if someone opens `/migrate` for it — see below — but the price itself is
correct either way now.)

## The fix (2026-08-20)

**1. `formula-engine.ts` no longer reads or prices `product_option_rates`.** Removed the load
(old lines 283-287) and the entire second pricing loop (old lines 319-381) — one self-contained
block, replaced with a comment pointing here. Nothing else in the function changed; the recipe
loop (`product_default_items`) is untouched. Reversible in one revert if this doc's conclusions
ever turn out to be wrong.

**2. Re-verified Banner Regular through the real path:** **$296.02**, exactly the price
predicted from removing the $120.67 in duplicate cost. Confirmed via the pricing function's own
output that no breakdown row carries the `inactive` field anymore (the tell for a row that used
to come from `product_option_rates`).

**3. Re-verified 5 more affected, active products spanning different product types** (H=24,
W=36, Qty=1 — the same default dimensions the product-detail "Check Pricing" panel uses):

| Product | Type | Before | After |
|---|---|---|---|
| Wall Signs (Paintable) - .25in Solid Aluminum... | Signs / Large Format Printing | $265.67 | $134.88 |
| Polycarbonate/Lexan- Digital Translucent Vinyl Transfer (3 Layer) | Illuminated Signs | $315.91 | $162.41 |
| ARG Petro- Tanker Black Cast Kiss Cut Graphics | Fleets/Vehicle Wraps | $458.30 | $458.30 |
| Moderate Icon & Text Logo Design w/ Branding Booklet | Branding | $97.38 | $48.69 |
| Wall Sign- Full Color Comp Alum with GI-18/GI-00 Pads... | (uncategorized) | $896.32 | $488.50 |

Four of five dropped substantially, as expected. **The one that didn't (ARG Petro) is a real,
explained result, not a gap in the fix** — every one of its 8 `product_option_rates` rows has
`multiplier: 0`, so they contributed $0 to the total at any dimensions even before the fix;
its actual price comes entirely from two `Material` rows, which `product_option_rates` never
carries (its own `rate_type` CHECK constraint only allows `labor_rate`/`machine_rate` — never
`Material`). Confirmed by re-running with the code temporarily reverted (`git stash`) to get
the "before" column, then restored.

**4. Fixed the cause: `bulk-import-shopvox/route.ts` no longer writes to
`product_option_rates`.** Removed `optionRateRows` construction (`seenLabor`/`seenMachine`
dedup, the two `optionRateRows.push()` calls) and the delete+insert against that table. It was
built specifically to keep the Migrate page's Labor/Machine sections populated (its own old
comment said so) — now that nothing reads that table for pricing, writing to it is dead work
that would just keep re-accumulating exact duplicates on every future bulk-import run. Without
this fix, the double-write (and the risk of some future code reading that table again and
re-introducing the double-pricing bug) would have kept happening on every subsequent import.

## Migrate page Labor/Machine display — recommendation, not built

Ruben's assumption was right and should become true: **the Migrate page's Labor/Machine
sections should read from `product_default_items`, the same way its Materials section already
does**, instead of `product_option_rates`. That's the only remaining real reason
`product_option_rates` still exists as a concept — with the bulk-importer fix above, newly
(re-)imported products will show correct labor/machine rates in `product_default_items` but an
**empty** Labor/Machine display on the Migrate page, since that page still only reads the now
unpopulated table. This is a display gap, not a pricing one, but it's real and will confuse
whoever opens `/migrate` for a freshly-imported product next.

**Not built in this pass** — deliberately scoped out of the pricing fix (this PR is
`formula-engine.ts` + `bulk-import-shopvox/route.ts`, both small and self-contained; changing
`migrate-client.tsx`'s Labor/Machine sections, `actions.ts`'s save path, and `page.tsx`'s fetch
is a separate, larger UI change touching a 1,600-line client component). Concretely, what it'd
take: `migrate-client.tsx`'s `laborRateRows`/`machineRateRows` (currently seeded from
`existingOptionRates`, lines ~247/254) would seed from `existingDefaultItems.filter(item_type
=== 'LaborRate'/'MachineRate')` instead, matching the Materials section's own pattern exactly;
`actions.ts`'s `replaceOptionRates()` would become dead code (or get removed); and the save
bundle's `defaultItems` construction would need to include Labor/Machine rows the same way
Materials rows already do. Worth its own PR.

## Separate, still-open decision: what to do with the 5,903 existing rows

**Not deleted. Not decided here — deliberately not bundled into the pricing fix**, per
instruction. The rows are backed up
(`backups/2026-08-20T00-31-39Z-product_option_rates.json`) and now have zero effect on price or
anything else in the app (nothing reads `product_option_rates` anymore, on either the pricing
or the write side). They're inert, not actively harmful, so there's no urgency forcing this
decision — options, unchanged from the prior version of this doc:

1. Leave them as-is indefinitely — genuinely harmless now that nothing reads or writes them.
2. `DELETE` them once the Migrate-page change above ships (at that point they're not even
   serving their last real purpose — populating that page's display — since the page would read
   `product_default_items` instead).
3. Something else Ruben has in mind that this investigation didn't anticipate.

This needs Ruben's explicit sign-off, not a recommendation executed on his behalf — flagging it
here so it doesn't get forgotten, not proposing an action.

## Related

- `known-issues/2026-08-19-pricing-tables-product-option-rates-vs-default-items.md` — the prior
  doc this one corrects the product-count figure in and follows up on.
- `backups/2026-08-20T00-31-39Z-product_option_rates.json` — full pre-fix backup, 5,903 rows.
- `src/lib/pricing/formula-engine.ts` — the recipe loop (`product_default_items`) is the only
  pricing loop left; the `product_option_rates` load + loop were removed.
- `src/app/api/products/bulk-import-shopvox/route.ts` — no longer writes to
  `product_option_rates`; still writes `product_default_items` with ALL item types (Material +
  LaborRate + MachineRate), unchanged.
- `src/app/(dashboard)/dashboard/[slug]/products/bulk-import-shopvox-button.tsx` — the UI
  trigger for that route.
- `src/app/(dashboard)/dashboard/[slug]/products/[id]/migrate/migrate-client.tsx` — where the
  Labor/Machine-from-`product_default_items` change described above would land.
- `supabase/migrations/150_product_option_rates_rls_policy.sql` — header comment corrected in
  the prior commit; policy itself confirmed live, not pending.

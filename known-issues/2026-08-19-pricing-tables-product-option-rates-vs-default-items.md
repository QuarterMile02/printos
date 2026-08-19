# 2026-08-19 — Which table actually drives pricing: product_default_items vs product_option_rates

## Status

**Investigation only, reported per Ruben's request — nothing changed.** Triggered by a direct
contradiction between migration 150's own comment (claims `formula-engine.ts:78,283-287` reads
`product_option_rates`) and an earlier claim from this session that pricing comes from
`product_default_items` only. Re-verified from the current file with line numbers below.
**Migration 150's comment is correct; the earlier claim was wrong.**

## a) Which table(s) does `calculateProductPrice()` actually read, and what does each contribute?

**Both**, unconditionally, every time a quote line item is priced. `src/lib/pricing/formula-engine.ts`:

- **`product_default_items`** — loaded at line 93-97 as `recipeItems`, priced in the main loop
  at lines 178-265 (materials, labor, machine, and custom items alike — `item_type` can be any
  of `Material`/`LaborRate`/`MachineRate`/`CustomItem`). This is the "recipe": every row always
  contributes to `totalCostCents`, and to `basePriceCents` when `include_in_base_price` is set.
- **`product_option_rates`** — loaded at line 283-287 (exactly the lines migration 150's
  comment names), priced in a second loop at lines 319-381. Every row **also** unconditionally
  adds to `totalCostCents` (line 378) and `basePriceCents` (line 379) — with one extra
  capability the recipe loop doesn't have: a row with `modifier_formula` set gets gated on/off
  (or scaled, for a numeric modifier) by a product modifier's live value at quote time (lines
  349-361). Both loops feed the exact same running totals and the same final
  `unit_price_cents` — there's no sense in which one table is "real" and the other is
  decorative or unused.

Concretely: if a product has rows in both tables, the price is `recipe total + option-rate
total`, modifiers applied, then markup and discounts on top (lines 415-448). Neither table can
be edited safely in isolation without knowing the other's contents contribute to the same
number.

## b) What is `product_option_rates` actually FOR?

Migration 034's own comment says it stores *"the rates a sales rep can choose from at quote
time."* That framing is **not what happens today** — grepped every quote-facing file
(`quote-detail-client.tsx` and everything under it) and `PricingInput`
(`formula-engine.ts:6-13`): there is no `selected_option_rate_id`-shaped field anywhere, and no
UI at quote-entry time that lets a sales rep pick among candidate labor/machine rates for a
line item. `product_option_rates` rows are 100% server-configured per **product** (via the
Migrate page), not chosen per **quote**.

The one real behavioral difference from a recipe row is the `modifier_formula` gate described
in (a) — so in practice `product_option_rates` today means *"a labor/machine rate that's
included in the price only when some other product modifier is checked/set,"* not *"a rate the
sales rep picks from a list."* Worth noting: `product_default_items` also has a
`modifier_formula` column (added in migration 033, still selectable, still writable from the
Migrate page's Materials section) — but `formula-engine.ts`'s recipe loop never reads it
(compare the `select()` at line 95, which omits `modifier_formula`, against `product_option_rates`'s
`select()` at line 285, which includes it). **Confirmed live via the DB itself**: 0 of the
9,045 `product_default_items` rows have a non-null `modifier_formula` — so this isn't just a
theoretical dead column, nobody has hit it in practice either. Whatever originally motivated
"choose at quote time," what exists today is: **an unused concept name attached to a real,
actively-used mechanism** (modifier-gated labor/machine charges) that's simply not exposed as
sales-rep choice anywhere.

Scale, confirmed live against the DB (service-role, bypasses RLS):

| | rows | distinct products |
|---|---|---|
| `product_default_items` | 9,045 (Material 2,588 / LaborRate 4,756 / MachineRate 1,701 / CustomItem 0) | — |
| `product_option_rates` | 5,903 (labor_rate 4,334 / machine_rate 1,569) | 119 of 887 total products (~13%) |

So `product_default_items` already carries the *majority* of labor/machine rate rows
(4,756 + 1,701 = 6,457) in addition to every material row — `product_option_rates` is a
smaller, additional set used by a minority of products.

## c) Migrate page: Materials from `product_default_items`, Labor/Machine from `product_option_rates` — deliberate or bug?

**Deliberate, not a typo** — consistently wired end to end:
`migrate-client.tsx:241` seeds `materialRows` from `existingDefaultItems.filter(item_type ===
'Material')`; `:247` and `:254` seed labor/machine rows from `existingOptionRates.filter(rate_type
=== 'labor_rate'/'machine_rate')`. The save path mirrors it exactly — `actions.ts`'s
`replaceDefaultItems()` (103-131) writes only what the Materials section built, and
`replaceOptionRates()` (133-153) writes only what the Labor/Machine sections built. Both are
called together on every save (`saveMigrationDraft`/`publishMigration`, lines 259-261 and
314-315) — this is intentional design, not an accidental omission.

**But "deliberate" isn't the same as "safe," and there's a real, currently-live bug riding on
top of that design** — migration 150's own comment already found it and it hasn't been
touched since: `product_option_rates` has RLS **enabled with zero policies**, and migration
150 (the fix) is marked *"Applied: PENDING — run manually in the Supabase SQL Editor (Ruben),
not auto-applied by Claude Code."* I found no evidence in the repo that it's been run since.
**Could not confirm live from this session** (no DB/psql access, only the app's own Supabase
clients) — this needs a 30-second check in the Supabase dashboard (`select * from pg_policies
where tablename = 'product_option_rates'`) before relying on the Migrate page for anything
touching Labor/Machine. If it's still unapplied, the consequence isn't just a display bug:
migration 150 also documents that `replaceOptionRates()`'s unconditional delete-then-insert
means **any save of the Migrate page for a product that already has option rates — even one
that only touches an unrelated section — silently wipes those rows to zero**, because the page
can't see the existing rows to resubmit them. With 119 products currently holding 5,903
`product_option_rates` rows, that's real data at stake if that policy is still missing.

## d) Which editor should Ruben build the ~50 simplified products in?

**`/products/[id]/edit`, not `/products/[id]/migrate`.**

- `/edit`'s `page.tsx` (48-78) fetches `product_default_items` only — it never queries or
  writes `product_option_rates` at all (confirmed: no reference to that table anywhere under
  `.../products/[id]/edit/` or the shared `product-form.tsx` it renders). Everything — 
  Material, LaborRate, MachineRate, CustomItem — goes into the one table, through the one
  well-understood, RLS-clean path.
- That's a fully valid, actively-used path today: 4,756 LaborRate + 1,701 MachineRate rows
  already live in `product_default_items` right now, well outnumbering
  `product_option_rates`'s 5,903 across a small minority of products.
- `/migrate` is purpose-built for the ShopVOX import/migration workflow (has a
  `migration_status` field, a ShopVOX JSON importer, migration-tracking UI) — its two-table
  split appears to be a byproduct of that migration process, not something a new,
  built-from-scratch product needs, and it currently carries the live RLS/data-loss risk in
  (c) on top of that.
- The only real capability gap: `/edit`'s single-table model has no equivalent for the
  modifier-gated "only charge this labor/machine rate when a modifier is set" behavior described
  in (b) — if any of the 50 new products genuinely need that (not just "unused concept," an
  actual per-product requirement), that specific rate would need to go through
  `product_option_rates` regardless of which editor is used for everything else. Worth
  confirming with Ruben up front whether any of the 50 need it; if none do, `/edit` covers all
  of them cleanly.

## Related

- `src/lib/pricing/formula-engine.ts` — the pricing engine itself, both loops.
- `src/app/(dashboard)/dashboard/[slug]/products/[id]/migrate/{page.tsx,migrate-client.tsx,actions.ts}`
- `src/app/(dashboard)/dashboard/[slug]/products/[id]/edit/page.tsx`, `../../product-form.tsx`
- `supabase/migrations/034_rate_categories.sql`, `033_product_default_items_fields.sql`,
  `150_product_option_rates_rls_policy.sql` — the RLS gap, marked pending as of this writeup.

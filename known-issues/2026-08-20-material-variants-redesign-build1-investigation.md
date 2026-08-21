# 2026-08-20 — Material redesign Build 1: findings A, B, C (pre-build investigation)

## Status

Investigation only, per instruction ("Report A, B and C BEFORE any build work" / "REPORT FIRST,
THEN STOP FOR THESE THREE"). No schema, no code. Waiting on Ruben's read of this before Build 1
(material_variants, material_colors, material_vendors additions, delivery_methods, the migrate
proposal screen) starts.

All counts below are live queries against the production Supabase project (org
`4ca12dff-97be-4472-8099-ab102a3af01a`), paginated past PostgREST's 1,000-row default cap where
relevant (material_vendors: 893 rows, well under the cap, but materials itself is 1,788).

## Finding A — materials.width / materials.height for "Rigid Substrates- Sheets"

`material_types` row: `Rigid Substrates- Sheets` → id `c46993b8-f891-448f-a470-1fe09a871d64`.
`materials.material_type_id = that id` → **235 rows**, matching the number in Ruben's prompt.

| | count |
|---|---|
| both `width` and `height` populated | **227** |
| neither populated | **8** |
| exactly one populated | **0** |
| — of which: genuine size token in the name | **57** (all 57 are inside the 227 "both" — i.e. a variant name *and* the row already carries that variant's dimensions) |

The "size token in name" scan needed a manual false-positive pass. A naive `\d.{0,4}x.{0,4}\d`
regex hit **64** rows, but **7** were vendor color/part codes that happen to look like a
dimension — `(CC3X2-500M)`, `(CC3X2-330M)`, `(3X1-501)` (ADA acrylic color codes) — not sizes.
Excluding those: **57 real size tokens**, all e.g. `Acrylic 4ft x 10ft White`, `Aluminum 5ft x
12ft Mill .125in x 1/8in`, `Acrylic 74in x 98in Black`, `Coroplast 4mm White- 18in x 24in`.

The **8 "neither populated"** rows are all Polycarbonate reel-length items misfiled under this
Sheets type (e.g. `Polycarbonate White .118in - 1/8" 52in`, `...56in Reel Ln Ft`) — no size token
in the name either (just a single width number, no `WxH` pair), so under Ruben's rule they'd
default to 48×96, which is likely wrong for a reel-length product. Flagging rather than silently
defaulting — worth a manual look before the migrate proposal runs on these 8.

So, applying Ruben's rule directly: **170 materials** (227 both − 57 with a name token) get a
single default-48×96 variant from their existing (already-correct-looking) width/height; **57**
get a second/variant-specific-size variant seeded from the name; the **8** neither-populated rows
need a decision (default 48×96 anyway, or hold out) since they don't look like true sheets.

## Finding B — where scraped ShopVOX material data lives today

**There is no staging table for materials.** This is the one finding that changes how item 8 as
spec'd should be built, so reading this before Build 1 starts matters.

Products have `products.shopvox_data jsonb` + `products.migration_status` (migration 032) — a
raw-scrape snapshot kept *on* the row, with an explicit reference→in-progress→ready state machine.
**Materials have no equivalent.** `materials` has no `shopvox_data`, no `migration_status`, no
ShopVOX-side id of any kind. Confirmed by reading materials' full live column list (72 columns) —
none of them.

What actually happens today, per `scripts/scrape-shopvox-material-tiers.js` +
`scripts/import-material-tiers.mjs`:

| Table | Rows (org) | Distinct materials | Link to `materials` |
|---|---|---|---|
| `public.materials` | 1,788 | — | is the target; updated **in place** by exact case-insensitive name match (`diffAndWriteMaterialFields` / `createMaterialFromShopVox`) |
| `public.material_pricing_tiers` | 22 | 6 | `material_id` FK, no `vendor_id` — tiers are material-scoped, not vendor-scoped |
| `public.material_vendors` | 893 | 407 | `material_id` FK |

Both tables are populated by a **delete-then-insert per material**, matched to `materials` by
exact case-insensitive name — the same matching approach used elsewhere in this codebase for
materials (no ShopVOX id is stored anywhere to match on instead). The actual raw scrape output —
the thing item 8 calls "the ShopVOX staging side" — lives only in a local JSON file that is never
written to the database: `scripts/shopvox-material-tiers-output.json` (107k lines, tiers + vendor
pricing) plus the ShopVOX CSV export for base fields (`data/Material_Export_List_4526.csv`). Base
`materials` fields (cost, dimensions, etc.) are scraped and written straight into the live
`materials` row too, with no jsonb snapshot retained anywhere to diff a later re-scrape against.

**This means item 8 as spec'd (`migrated_to_material_id`, `migrated_at`, `source_hash`, with a
NEW/MIGRATED/CHANGED filter) has nothing to attach to yet** — there's no existing staging row with
its own identity to carry those three columns. Two ways to close that gap, and the choice changes
the shape of items 8 and 9 non-trivially:

- **(a) New staging table** — e.g. `shopvox_material_staging`, populated by *future* re-scrapes
  (raw JSON in, one row per ShopVOX material, `source_hash` computed at insert). The 1,788 already-
  merged materials would need to be treated as pre-existing/already-migrated with no staging row
  behind them (or backfilled once from the existing JSON export), since they were never staged —
  they were written straight to `materials`.
- **(b) Track migration state directly on `materials`**, mirroring the products pattern
  (`shopvox_data` jsonb + status), rather than a separate staging table+FK. Simpler, no backfill
  question, but doesn't give a truly separate read-only-left-panel source the way the product
  Migrate page's left panel (backed by `products.shopvox_data`, a different row from the live
  product) does — for materials the "read-only ShopVOX view" and "the real material" would be two
  states of the *same* row instead of two different tables.

Need Ruben's call between (a) and (b) before item 8/9 gets built — it's the one part of the spec
that doesn't have an existing analog to extend, unlike everything else in items 1–7.

## Finding C — material_vendors: current columns and what's actually populated

893 rows / 407 distinct materials. Full column list with population:

| column | populated | note |
|---|---|---|
| `id`, `organization_id`, `material_id` | 893/893 | |
| `vendor_name` | 893/893 | free text, **not** FK'd to the `vendors` table (migration 042) |
| `vendor_price` | 893/893 | |
| `rank` | 893/893 | |
| `buying_units` | 893/893 | |
| `delivery_fee` | 893/893 | |
| `last_price_date` | 893/893 | |
| `active` | 893/893 | |
| `created_at`, `updated_at` | 893/893 | |
| `quantity` | 893/893 | confirmed flat at 1 in mig. 123's notes; real range still unconfirmed |
| `length` | 893/893 | |
| `sqft_price` | 893/893 | |
| `width` | 773/893 | |
| `part_number` | 323/893 | |
| `part_name` | 210/893 | |
| `image_url` | **0/893** | migration 123 called this "frequently empty" — live it's **always** empty |
| `info_url` | **0/893** | always empty |
| `length_per_unit`, `min_stock_level`, `max_stock_level`, `min_order_value`, `previous_price` | **0/893** | all always empty — older speculative columns, never populated by any import path found |

Two things worth flagging before extending this table further:

1. **Migration 123's header says "NOT YET APPLIED — proposed only"**, but `image_url`, `info_url`,
   `width`, `length`, `sqft_price`, `quantity` all exist live with real data (`quantity`/`length`/
   `sqft_price` at 893/893). It clearly *was* applied at some point — the header comment is stale,
   not a sign the columns are missing. Worth a one-line fix to that file's header so it stops
   reading as pending.
2. **(material_id, vendor_name) is confirmed not unique** — 54 combos appear more than once (same
   vendor, different rank/price row), matching migration 123's own note about "Grimco" appearing
   twice on one material. Anything added for `is_preferred` needs to either target a specific row
   (not just a material+vendor pair) or be recognized as applying to *all* that vendor's rows for
   the material.
3. **`vendor_name` has no FK to `vendors`** (the real vendor entity table, migration 042, org-
   scoped, has structured contact/address/terms fields). `material_vendors` rows are pure scraped
   text today. The new PO-routing fields (`vendor_url`, `delivery_method_id`, etc.) will sit on
   `material_vendors` per the spec, not on `vendors` — flagging only so it's a conscious choice
   that vendor-level settings (like a default delivery method) will live per-material-vendor-row,
   not once per real vendor.

Quantity-break rows: **not on `material_vendors` at all today.** The only existing "tier" concept
is `material_pricing_tiers` (22 rows, 6 materials) — `from_qty`/`to_qty`/`cost`/`price`, scoped to
`material_id` only, with **no vendor_id** — i.e. today's tiers already answer "what does this
material cost at quantity N" but never "what does *this vendor's* offering cost at quantity N".
The vendor-scoped quantity break the spec asks for (`qty_from`/`qty_to` with a Skid/Pallet-style
open-ended NULL) is a genuinely new concept, not an extension of an existing break-rows table —
it'll need its own table (`material_vendor_price_breaks` or similar, `material_vendor_id` FK) since
one `material_vendors` row is one price point today, not a set of tiers.

## Next step

Waiting for Ruben's read on this — specifically the (a)/(b) call in Finding B — before starting
schema (items 1–7) or the migrate screen (items 8–9).

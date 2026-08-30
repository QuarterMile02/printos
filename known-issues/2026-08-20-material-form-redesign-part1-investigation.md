# 2026-08-20 — Material form redesign, Part 1: investigation (A–D)

## Status

**Investigation only for A–D — informs Part 2, nothing acted on here.** The build in this PR
(reorder + Units of Business dropdown) does not depend on any of these findings, per
instruction. Recorded so the answers aren't re-derived when Part 2 starts.

## A) Every distinct value of "materials.type"

**No column literally named `type` exists on `materials`.** Three "type"-adjacent columns do:

- **`material_type`** (legacy text) — confirmed live: **100% NULL across all 1,788 rows.**
  Dead column.
- **`material_type_id`** (FK → `material_types`) — 23 distinct org-defined values (Roll
  Materials 369, Accessories 469, Electrical 168, Rigid Substrates- Sheets 235, Consumables
  106, Fabrication Materials 99, ... down to Ink 1, Artwork 1). This is a fine-grained
  **category** taxonomy, not a 2-3-value type — not what Ruben's describing.
- **`buying_units`** — **this is the real match.** Confirmed live, 13 distinct values:
  `Unit` (760), `Roll` (457), `Sheet` (243), `Case` (69), `Bag` (58), `Box` (108), `Ream` (17),
  `Feet` (19), `Gallon` (19), `Set(s)` (7), `Yard` (2), `Sqft` (6), plus 23 null. **Confirms
  both halves of what Ruben said: there is no "Raw Materials" value anywhere in this column,
  and "Unit" is real** — 760 materials, the single largest group. This is also the column the
  "type-driven field labels" idea (Roll Width/Roll Height/Roll Cost for Roll type) already
  implicitly depends on, since `Roll`/`Sheet` are two of its values.

**Answer: `buying_units` is "materials.type."** No "Raw Materials" value exists; "Unit" is
confirmed real (the largest single group). Report given with the caveat that no column is
literally named "type" — this is the closest and only real match.

## B) The two dimension pairs

**Packaging pair (`unit_width` / `unit_height`)** — written only by the manual material form
(`material-import-mapper.ts` has no CSV header mapping for it at all — confirmed by absence in
`HEADER_MAP`). Read only by the material's own settings detail-view display ("Unit Size:
{w}" × {h}""`, `[id]/page.tsx:260`). **Written but never read anywhere else** — not the
pricing engine, not the scraper, not PDF routes, not quote paths. Confirmed via full-repo grep:
zero hits outside the four materials-settings files themselves.

**Material pair (`width` / `height`, under "Dimensions & Sheet")** — written by BOTH the
manual form and the ShopVOX CSV import (`material-import-mapper.ts:31-32,209-210`, feeding
`import/actions.ts`). **Is read** — but only by `computeMaterialLineItem()`
(`src/lib/pricing/compute-line-item.ts:57-58`), which is itself called *only* from
`shopvox-quote-preview.tsx` (the Migrate page's client-side preview simulator, not real
pricing). Confirmed the real pricing engine (`calculateProductPrice()` /
`formula-engine.ts`) never selects or references `materials.width`, `.height`, or
`.fixed_side` at all — same pattern already found for `wastage_markup`.

## C) The Unit Cost collision

**Same column, and it's genuinely unused — confirmed, not assumed.** `materials.unit_cost`:
**0 of 1,788 rows have a non-null value.** Grepped every remaining reference post-PR #24: the
only other `unit_cost` in the codebase is `purchase_order_items.unit_cost` — a **different
column on a different table** (a PO line item's per-transaction cost), unrelated by name
coincidence only.

**The real "what does a Unit-type material cost to buy" logic already exists, and doesn't use
this column at all**: `src/app/api/materials/route.ts:49` —
`buy_unit_cost: m.sheet_cost ?? (m.sell_buy_ratio ? m.cost * m.sell_buy_ratio : null) ?? m.cost`
— this is what pre-fills a PO line item's cost when a material is picked
(`material-select.tsx`/`PurchaseOrderDetailClient.tsx`). For a `buying_units = 'Unit'`
material, that fallback chain lands on plain `cost` (or `cost * sell_buy_ratio` if set) — the
existing pricing columns already cover it. **No separate cost field is needed for Type =
Unit** — `unit_cost` isn't it, and nothing needs to be built to replace it either.

## D) Weight / Weight UOM

**One column pair, not two.** Confirmed live: only a single `weight` + `weight_uom` pair
exists on `materials` — no second "weight per sqft" column anywhere in the schema. Populated
on 258/1,788 materials; `weight_uom` has exactly one real value in use (`Lb`, 256 rows) despite
the form offering `lbs/kg/oz/g`.

**What reads it:** only the CSV import (`material-import-mapper.ts` → `import/actions.ts`) and
the material form/detail view. Nothing else — not pricing, and (checked, since it seemed like
an obvious candidate) not the shipping-rate flow either: `shipment-form-client.tsx` and
`quote-detail-client.tsx`'s package-weight fields are manually typed at shipment time, with no
link back to `materials.weight` at all.

**Ruben's "two weight concepts" (roll weight vs. weight-per-sqft) don't exist in the schema
today** — there's only the one flat value. A second column (e.g. `weight_per_sqft`) would need
to be added for that distinction to be representable at all — not done here, presumably Part 2
alongside the other dimension/type-driven rework.

## Related

- This PR's actual changes (Units of Business dropdown, section reorder) do not depend on any
  of the above — built independently, per instruction.
- `src/lib/material-import-mapper.ts`, `src/lib/pricing/compute-line-item.ts`,
  `src/lib/pricing/formula-engine.ts`, `src/app/api/materials/route.ts` — the files cited above.
- `known-issues/2026-08-21-wastage-markup-semantics.md` — the same "written but never read by
  real pricing" pattern, found first on `wastage_markup`, now confirmed again on the material
  dimension pair.

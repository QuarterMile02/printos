# 2026-08-21 — wastage_markup: percentage → multiplier, converted at the import boundary

## Status

**Fixed at every live write path, plus the one dead one, for consistency.** Ruben's decision:
stop using percentages on `materials.wastage_markup`, use a plain markup multiplier — same
convention as `multiplier` elsewhere in PrintOS (1 = cost only/no wastage, 2 = cost doubled).
`markup = 1 + (shopvox_value / 100)`.

## The outranking question, answered first, empirically

**What does the real pricing engine do with `wastage_markup = 100` today?**

**Nothing. It's completely unused in live pricing.** `calculateProductPrice()`
(`src/lib/pricing/formula-engine.ts`) — the function every real quote line item goes through —
never references `wastage_markup` anywhere. Materials are priced there via `computeLineItem()`
using `materials.cost`/`price` and `material_pricing_tiers`, with no wastage adjustment at all.

**Proved live, not just read from code:** picked a real active product ("Coroplast Sign 4mm")
using a real material with `wastage_markup = 100`, priced it at 48"×96" through
`calculateProductPrice()` — **$149.18**. Then, on the live material row, set
`wastage_markup` to `1`, re-priced — **$149.18**. Set it to `0` — **$149.18**. Set it to
`99999` — **$149.18**. Reverted the material back to `100` afterward (confirmed via a
follow-up read). All four prices identical, regardless of the value.

**The one place that DOES read it, `computeMaterialLineItem()`
(`src/lib/pricing/compute-line-item.ts`), is itself not in the real pricing path either** —
its only caller is `shopvox-quote-preview.tsx`, the Migrate page's client-side "preview" tab,
a separate self-contained JS simulator of what ShopVOX would compute, not what PrintOS
actually charges on a quote. And even there, `wastage_markup` only affects a waste-strip
calculation gated behind `calculate_wastage && fixed_side` — it does nothing to the base
material cost otherwise.

**Conclusion: current live quote prices are unaffected by this column's value, in either
direction.** This isn't a live 100x bug — it's dead data as far as real pricing goes. Changing
its semantics is a correctness/clarity fix for whenever it DOES get wired into real pricing
(not done here, not asked for here), and for anyone reading the number today, not an emergency
price correction.

## Every import/write path, identified before changing anything

1. **`src/lib/material-import-mapper.ts` `buildRow()`** — the live path. Feeds both
   `importMaterialsBatch()` and `applyMaterialImport()`'s `buildRecord()` in
   `settings/materials/import/actions.ts` (the real, UI-wired ShopVOX CSV import — "Import
   Materials" button). Source CSV header is literally `"Wastage Markup (X)"` (confirmed —
   same `(X)` convention as `"Multiplier (X)"`), previously passed straight through with no
   conversion. **Fixed here** — `buildRow()` now applies `convertWastageMarkupToMultiplier()`
   before either write path ever sees the value. Since `material-import-mapper.ts` is a pure
   function shared by the client preview table too, the preview now also shows what will
   actually be stored, not the raw ShopVOX percentage.
2. **`settings/materials/actions-sr.ts` `saveMaterial()`** — the manual single-material
   create/edit form (not an "import" of ShopVOX data, a human typing a number). Already stored
   whatever was typed with no math applied — no conversion needed there, but the form's own
   label said "Wastage Markup %" while the column now means "(X)". Left uncorrected, that's
   the exact same failure class via a different door: someone reads "100" in an old record
   under the new semantics, or types "100" meaning 100% into a field now interpreted as a raw
   multiplier. **Fixed**: relabeled to "Wastage Markup (X)" with a one-line explainer, and the
   invalid-input fallback changed from `|| 0` to `|| 1` (0 would now mean "free material,"
   not "no wastage").
3. **`settings/materials/actions-sr.ts` `importMaterialsCsv()`** — a second, separate, ad-hoc
   CSV importer with its own hardcoded header map (`'wastage markup'`, no `(X)`). **Confirmed
   dead code** — zero callers anywhere in the UI (grepped; only its own definition file
   references it). Fixed anyway for parity, flagged as unreachable in a comment, in case it's
   ever revived.
4. **`cloneMaterial()`** — copies `wastage_markup` verbatim from an existing (already-correct,
   post-conversion) material row. No conversion needed — it's copying stored data, not
   translating from a raw ShopVOX source.
5. **`bulk-import-shopvox/route.ts`** — writes a *different* column entirely
   (`product_default_items.wastage_percent`, a per-recipe-item override), never touches
   `materials.wastage_markup`. Out of scope for this task, not touched.
6. **`/api/export/materials`** — reads and exports whatever's stored, unchanged. Its own CSV
   header is `"Wastage Markup"` (no `(X)`), which doesn't match `material-import-mapper.ts`'s
   `"wastage markup (x)"` lookup key at all — re-importing a PrintOS export back through the
   ShopVOX-mapper path safely lands in `unmappedHeaders` (ignored) rather than double-converting.
   Not a risk, just noted; not changed.

## Not done

**No migration on the 1,788 existing rows**, exactly as instructed — they keep whatever raw
values they have (mostly ShopVOX-percentage-shaped: 252 materials at exactly `100`, plus
smaller counts at `2`, `1.5`, `50`, `5`) until the next re-scrape naturally runs them back
through the now-fixed import path. Since nothing in real pricing reads this column today,
that's not urgent for correctness — but it does mean existing records currently display
inconsistently with new ones (an un-migrated `100` reads as "100x" under the new multiplier
label until it's re-imported or hand-edited). Flagging, not fixing — a one-time backfill of the
existing 1,788 rows is a separate, explicit decision for Ruben, not something to do quietly
alongside the boundary fix.

## Related

- `src/lib/material-import-mapper.ts` — the conversion function and its call site.
- `src/app/(dashboard)/dashboard/[slug]/settings/materials/actions-sr.ts` — manual form +
  legacy CSV importer.
- `src/app/(dashboard)/dashboard/[slug]/settings/materials/material-form.tsx` — relabeled field.
- `src/app/(dashboard)/dashboard/[slug]/settings/materials/import/actions.ts` — the two live
  write functions consuming `MaterialImportRow.wastage_markup`, unchanged (fix lives upstream
  in the mapper).
- `src/lib/pricing/formula-engine.ts`, `src/lib/pricing/compute-line-item.ts` — confirmed not
  reading this column in the real pricing path.

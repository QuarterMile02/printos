# Quote Preview: real pricing, reference panel stays read-only

**Date:** 2026-08-21
**Context:** Correction to PR #23 (merged 2026-08-19, "ShopVOX reference panel Width/Height synthesis"). PR #23 added a "Check Reference Price" block directly to the read-only Migrate reference panel, with its own parallel pricing implementation (`src/lib/pricing/shopvox-reference-price.ts`). Ruben's decision: the reference panel must stay a pure read-only ShopVOX mirror; all real pricing belongs on the Quote Preview tab, computed through the actual PrintOS pricing engine.

## What changed

### 1. Reference panel (`shopvox-reference-panel.tsx`) — pricing UI removed
Deleted the entire "Check Reference Price" block: Width (in) / Height (in) / Qty inputs, the "Check Reference Price" button, and the result display. Also removed the `productId` / `pricingType` / `formula` props the block needed — the component signature is back to `{ shopvoxData }`, matching its shape before PR #23. Everything else (Basic Info, Pricing metadata, Modifiers list with checkboxes, Dropdown Menus, Default Items) is unchanged. This panel is a review/import checklist only — it never prices anything.

### 2. Quote Preview (`shopvox-quote-preview.tsx`) — now the real pricing tool
Rewritten to call the real pricing path instead of reimplementing it. New props:

```ts
type Props = {
  productId: string
  productModifiers: QuoteModifierInput[] // the product's REAL recipe modifiers (product_modifiers + modifiers catalog)
}
```

- Width (in) / Height (in) / Qty inputs, defaulting to 48 / 96 / 1.
- Every recipe modifier rendered as a usable input: Numeric → number field, Boolean → checkbox, each seeded from `product_modifiers.default_value`.
- On any input change (debounced 400ms), POSTs to `/api/pricing`, which calls `calculateProductPrice()` in `src/lib/pricing/formula-engine.ts` — the same function real quotes use. No parallel math lives in this component anymore.
- Renders a cost-by-category box (Material / LaborRate / MachineRate / Modifier, plus Custom if present) computed by summing the engine's own `breakdown[].cost_cents` by `item_type`, followed by the full line-item table and a sticky Cost/Sell/Margin/Total bar — so a wrong number is diagnosable by category, not just a single total.

The source of "the product's modifiers" is `product_modifiers` joined to the `modifiers` catalog (fetched server-side in `migrate/page.tsx` as `productModifiers`), **not** the raw `shopvox_data.modifiers[]` scrape — confirmed live that Coroplast 4mm's `product_modifiers` already has the same 23 rows Ruben cited, each resolving to a real catalog modifier, and that only `product_modifiers` actually feeds `calculateProductPrice()`'s `selected_modifiers` lookup.

### 3. Width/Height injection — kept, moved (not deleted)

Ruben's diagnosis: when a ShopVOX product's Pricing Type is Formula and Formula is Area/Total_Area/Perimeter (or Width-only/Height-only), ShopVOX synthesizes Width and Height at its own quote time and never stores them as modifiers — so the scraped `shopvox_data.modifiers[]` array never has Width/Height rows for these products, but the PrintOS recipe still needs them to price with the real engine.

Previously this only existed as a hardcoded UI default (`width` state defaulting to `'48'`, `height` to `'96'`) inside the old `ShopvoxQuotePreview` component — a default that never survived past that one component and never made it into the saved recipe.

**Moved to:** `handleImportFromShopvox()` in `src/app/(dashboard)/dashboard/[slug]/products/[id]/migrate/migrate-client.tsx`, immediately after the existing shopvox-modifier-name-matching loop. At the point a ShopVOX product is actually copied into a PrintOS recipe, the code now:

- Reads the product's `pricing.pricing_type` / `pricing.formula` (Area, Total_Area, Perimeter → need both; Width → width only; Height → height only; else → none).
- For each dimension needed, looks up the org's real "Width"/"Height" modifier catalog rows by name (via the same `modifierByName` map used for every other modifier) and, if not already present from the scrape, injects a `product_modifiers` row pointing at that catalog modifier with `is_required: true` and `default_value` 48/96.
- If the org has no "Width"/"Height" modifier in its catalog, this silently no-ops — same behavior as any other unmatched modifier in the loop above, not a new failure mode.

This means Width/Height now end up as real, persisted `product_modifiers` rows on the recipe (so they seed real inputs in Quote Preview and participate in `calculateProductPrice()`), instead of a UI-only default that disappeared on page reload.

**Judgment call, not further changed:** the outer visibility gate for rendering Quote Preview (`leftMode === 'preview' && hasShopvox`) still requires `hasShopvox`, even though Quote Preview no longer reads `shopvox_data` directly. Left as-is — this scope was the four items above, not the panel's visibility gating.

### 4. `src/lib/pricing/shopvox-reference-price.ts` — deleted

With the reference-price UI removed, this file (and its route, `src/app/api/pricing/shopvox/route.ts`) had zero callers — confirmed via `grep -rln "calculateShopvoxReferencePrice\|api/pricing/shopvox\|shopvox-reference-price" src`, which returned only the file and its route itself. Both were deleted.

The file contained two real bug fixes over the naive approach: (a) checking `item_type`/`per_li_unit` field names correctly, and (b) dividing by `production_rate` (missing in an earlier draft). Neither fix needs to be preserved elsewhere:

- The real engine, `calculateProductPrice()` in `formula-engine.ts`, never had either bug — `item_type` is read as a genuine `product_default_items` column (not a scraped JSON key with naming variants), and it has always used the shared `computeLineItem()` helper, which correctly divides by `production_rate`.
- The old `shopvox-quote-preview.tsx` being replaced in this change also never had either bug — it already treated `item_type`/`per_li_unit` as primary field names and already used `computeLineItem()`/`computeMaterialLineItem()` from day one.

The bugs were unique to `shopvox-reference-price.ts` itself and die with it.

## Live verification

Ran `calculateProductPrice()` directly against Coroplast 4mm - Direct Printing (`product_id 0fb753d7-5770-4b5f-84a0-580d9fbe2604`) with width=48, height=96, qty=1, and `selected_modifiers` seeded from that product's real `product_modifiers.default_value` (all 23 modifiers at their defaults — no options toggled on), mirroring exactly what Quote Preview's inputs send.

**Result: unit price $244.99, total $244.99** (no discount assigned), broken down as:

| Category | Cost |
|---|---|
| LaborRate | $190.69 |
| MachineRate | $1.44 |
| Material | $52.86 |
| Modifier | $0.00 |
| **Total cost** | **$244.99** |

Product markup is 0/null on this record, so the engine's default-to-1 rule applies (`unit_price = total_cost × 1`) — price equals cost at these defaults.

**This is lower than the pre-fix $279.70**, confirming PR #22's product_option_rates double-charge fix has landed on this product and Quote Preview now surfaces the corrected number through the real pricing path.

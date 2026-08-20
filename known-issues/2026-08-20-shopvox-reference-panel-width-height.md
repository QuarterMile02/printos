# 2026-08-20 — Synthesized Width/Height on the ShopVOX reference panel

## Status

**Built and verified against real data — Ruben still needs to run the ShopVOX-side half of
the comparison (see bottom).** Along the way, found and fixed two pre-existing bugs in
`/api/pricing/shopvox` that made it return $0 or wildly inflated numbers for every real
product — this route had zero callers anywhere in the app before this task wired the
reference panel to it, so nothing had ever exercised it against real scraped data before now.

## Catalog survey (as instructed, before building anything)

All 887 products, by `pricing_type`: **Basic 570, Formula 253, Grid 64.** Only `Formula`
products are in scope for this rule (`Basic`/`Grid` use different pricing mechanisms
entirely, untouched here).

Of the 253 `pricing_type = 'Formula'` products, distinct `formula` values:

| formula | count | active | dimensional? |
|---|---|---|---|
| `Area` | 251 | 236 | both (W+H) |
| `Total_Area` | 1 | 1 | both (W+H) — computed identically to Area in `formula-engine.ts` |
| `Unit` | 1 | 1 | neither |

**No `Perimeter`, `Width`, `Height`, or `None` formula exists anywhere in this catalog.**
The `Total_Area` and `Unit` products are both single, identifiable rows — `Total_Area` is
literally named "Vehicle Wrap- Solid Color Change (TOTAL AREA TEST)" (a test product), `Unit`
is "Business Cards 1000". Implemented the full rule from the brief (Perimeter/Width/Height
all handled in code, per the given mapping) since it was fully specified, not invented — but
Perimeter/Width/Height branches are **unverified against a real product**, since none exists
to check against. Flagging rather than skipping, per instruction.

## What was built

1. **`ShopVOXReferencePanel`** (`src/components/products/shopvox-reference-panel.tsx`) —
   new "Check Reference Price" section, shown whenever `pricingType === 'Formula'`:
   - Renders Width and/or Height inputs based on `dimensionalMode(formula)` — both for
     Area/Total_Area/Perimeter, one for Width/Height-only, neither for Unit/None. Marked
     required (visually and via a blocking validation message) exactly when shown, matching
     ShopVOX's own behavior (synthesized, not read from the Modifiers list — confirmed
     earlier that ShopVOX doesn't store them as modifiers either).
   - Quantity input, always shown (defaults to 1).
   - "Check Reference Price" button — calls `/api/pricing/shopvox` with
     `{ product_id, width_inches, height_inches, quantity }`, following
     `calculateProductPrice()`'s existing param shape as instructed rather than inventing a
     new one.
   - Result display: total cost/sell, margin, discount (if any), and a compact per-line
     breakdown.
   - New props threaded in from `migrate-client.tsx`: `productId`, `pricingType`, `formula`
     (the product's own stored columns — the ones we scrape and store — not the
     `shopvoxData.pricing.*` copy, which could drift from them after import).

2. **`/api/pricing/shopvox`** — already accepted `width_inches`/`height_inches`/`quantity`
   in its body (no signature change needed, contrary to what the brief anticipated might be
   required) — the gap was that nothing in the app ever called it with real values. Also
   refactored its computation into a standalone, directly-callable function
   (`src/lib/pricing/shopvox-reference-price.ts`) — same reason `calculateProductPrice()`
   lives in its own module: testable/verifiable without going through the authenticated HTTP
   layer. No behavior change from the extraction itself; the auth check now runs on a cheap
   `organization_id`-only lookup *before* the full computation, not after, so an unauthorized
   caller can no longer force the extra materials/labor_rates/machine_rates/discount queries
   either.

## Two bugs found and fixed while wiring this up

Both were pre-existing, in the original inline route code — neither introduced by this task.
Both were invisible until now because the route had never been called with real data before.

**1. Wrong field names — `item.kind`/`item.per_li` don't exist on a real `default_items`
row.** Confirmed live against Coroplast 4mm- Direct Printing's actual `shopvox_data`: the
real fields are `item_type` (`"Material"`/`"LaborRate"`/`"MachineRate"`) and `per_li_unit`.
With the wrong names, `item.kind` was `undefined` for every item, so the
kind-based rate lookup fell through to `machineMap` for everything regardless of real type —
15 of Coroplast's 16 items came back "no rate match" ($0), the one that didn't
("Laminator") only matched by coincidence because it's genuinely a `MachineRate`. Fixed by
renaming to the real field names.

**2. Hourly rates weren't divided by `production_rate` before pricing.** A rate like "Zund
Drawing & EOT Stencil Labor" is `$97.87/Hr` with `production_rate: 48` (SqFt/Hr) — the
formula quantity (sqft) needs dividing by that throughput to get billable hours *before*
multiplying by the hourly rate. The original inline code skipped that division entirely
(`unitCost * chargeQty` directly), so every Hr-rated item — most labor and machine rates in
this catalog — was charged the full hourly rate *per sqft* instead of *per hour of actual
production time*. Fixed by reusing `computeLineItem()` (`src/lib/pricing/compute-line-item.ts`),
the exact same helper `formula-engine.ts` already uses for this — not reimplemented.

**Combined effect, confirmed live:** Coroplast 4mm- Direct Printing at 48"×96" priced at
**$14,146.72** before these two fixes, **$870.81** after — fixing bug 1 alone (without bug 2)
gave $887.20 (barely moved, since almost everything was still hitting the wrong-rate-lookup
path or the un-divided hourly math); both fixes together are what got it to a plausible
number for a 32-sqft sign.

## Count of products this unblocks

**All 253 `pricing_type = 'Formula'` products were completely unable to price via this
route before today** — not just the dimensional ones. `item.kind` being undefined affected
every item, regardless of formula; nothing had a way to supply Width/Height either, since
the route had no caller.

- **252 of 253** need Width/Height to price correctly at all (251 `Area` + 1 `Total_Area`) —
  these are the ones actually unblocked by the Width/Height work specifically.
- **1 of 253** (`Unit` — Business Cards 1000) doesn't need Width/Height, but was equally
  broken by the two bugs above and is fixed by the same underlying change.
- 236 of the 252 dimensional ones (plus the 1 Unit product) are `active = true` — the
  products actually reachable from a real quote today.

## Verify with a real comparison — my number, and what's needed from Ruben

**PrintOS reference side, Coroplast 4mm- Direct Printing, Width = 48in, Height = 96in,
Quantity = 1: total sell price = $870.81** (cost $244.99, margin 71.9%), computed via the
real `calculateShopvoxReferencePrice()` path (same function `/api/pricing/shopvox` calls) —
full 16-line breakdown available in the panel, or re-run
`calculateShopvoxReferencePrice({ product_id: '0fb753d7-5770-4b5f-84a0-580d9fbe2604',
width_inches: 48, height_inches: 96, quantity: 1 })` directly.

**What I need from Ruben:** open Coroplast 4mm- Direct Printing in ShopVOX's own Configure
Pricing → Check Pricing tab, enter the same **48in × 96in, Qty 1**, and report back the total
ShopVOX computes. That comparison working — PrintOS's number and ShopVOX's number agreeing —
is the actual validation method for every rebuilt product going forward, so it's worth
confirming this one matches (or, if it doesn't, finding out why) before relying on it for the
next 250-some products.

**Caveat, exactly as flagged:** this $870.81 number does **not** depend on PR #22 — the
reference-pricing path reads `shopvox_data.default_items` directly and never touches
`product_option_rates` at all, so it's accurate regardless of that PR's merge status. Where
PR #22 *does* matter: if Ruben (or anyone) separately compares against this same product's
already-**built** PrintOS recipe price (`calculateProductPrice()` / `product_default_items`,
e.g. via the product page's own "Check Pricing" panel), that number is currently **$437.12**
on unmerged `main` — inflated, because Coroplast has 11 `product_option_rates` rows still
being double-counted. With PR #22's fix applied, it's **$244.99** (checked both, temporarily,
for this report). Note that $244.99 *also* doesn't match the $870.81 reference number — see
below.

**Separately noted, not resolved here:** the built ($244.99) and reference ($870.81) numbers
disagree with each other even with PR #22 applied, and it doesn't look like a bug in either
— `calculateProductPrice()` prices as (total cost) × (one product-level markup), while this
reference path sums each item's own individual sell price directly. Two different pricing
philosophies already present in this codebase. Whether they should agree, and which one is
"right," is a real open question worth its own investigation — out of scope here, which is
specifically about the ShopVOX-vs-PrintOS-reference comparison Ruben is about to run, not
about reconciling PrintOS's own two internal pricing paths against each other.

## Related

- `src/components/products/shopvox-reference-panel.tsx` — the new Width/Height UI.
- `src/lib/pricing/shopvox-reference-price.ts` — extracted, fixed computation.
- `src/app/api/pricing/shopvox/route.ts` — now a thin wrapper around the above.
- `src/lib/pricing/compute-line-item.ts` — `computeLineItem()`, reused for the
  production_rate fix, not reimplemented.
- `src/app/(dashboard)/dashboard/[slug]/products/[id]/migrate/migrate-client.tsx` — passes
  `productId`/`pricingType`/`formula` into the panel.
- PR #22 (`fix/stop-pricing-product-option-rates`, not yet merged) — only relevant to the
  separate built-vs-reference comparison noted above, not to the reference number itself.

# Stage 0 — products category/type write/read split — report before the fix

**Status: report only, per instruction. No code changed, no migration written, no branch created.**
Org: `4ca12dff-97be-4472-8099-ab102a3af01a`. All counts below are direct, paginated live queries —
887 total products.

---

## a. Real counts

| | Set | Not set |
|---|---|---|
| `category_id` (legacy FK) | 866 | 21 |
| `product_category_id` (newer FK) | 14 | 873 |
| `product_type` (legacy text) | 870 | 17 |
| `product_type_id` (newer FK) | 14 | 873 |

**The specific counts asked for:**
- `product_category_id` set **but** `category_id` NULL: **0**
- `product_type_id` set **but** `product_type` NULL: **0**

That's the opposite of what the code trace alone predicted, and worth being precise about — the
code-level bug (new products get `category_id`/`product_type` left NULL forever, confirmed again
below) is real, but **zero live products currently exhibit it**. Checked why: all 14 products that
have `product_category_id` set *also* have `category_id` set, to the exact same value (checked
directly — 14 of 14 match, zero disagreements). Given `product-form.tsx` has no code path that
would ever set `category_id` to match a freshly-picked `product_category_id` (confirmed again
below), the only explanation is human, not automatic: these are 14 pre-existing products (already
carrying a real `category_id` from import/migrate) that someone later opened for editing, saw an
empty Category dropdown (because the dropdown is bound to `product_category_id`, which was null),
and manually re-picked the category they could see the product already had. That's a real,
separate symptom of the same bug — an already-categorized product reads as *uncategorized* the
moment someone opens it to edit — not a coincidence.

So the honest state of things: **873 of 887 products have never had their `product_category_id`/
`product_type_id` touched at all.** The 14 that have are all pre-existing products whose legacy
and new values happen to agree, by way of a human noticing and re-entering it. The **21** products
with `category_id` NULL and the **17** with `product_type` NULL predate this investigation and
aren't obviously attributable to this bug specifically (no signal distinguishes "created via the
current form and left blank" from "always uncategorized") — flagged, not asserted.

**A second, more severe live bug found while confirming this** — see below.

---

## The severity is worse than "some new products lack a category" — the products list shows NO category for ANY product, confirmed live

`products/page.tsx:62` embeds `product_categories(name)` with no FK qualifier. Since **two** FKs
now exist from `products` to `product_categories` (`category_id` and `product_category_id`), that
embed is structurally ambiguous. Tested directly against production with the exact same query:

```
error: {
  code: 'PGRST201',
  message: "Could not embed because more than one relationship was found for 'products' and 'product_categories'",
  hint: "Try changing 'product_categories' to one of the following: 'product_categories!products_category_id_fkey', 'product_categories!products_product_category_id_fkey'."
}
```

**This fails on every single call, for every product, every time the page loads.** The page
already has a defensive fallback for exactly this (`page.tsx:73-86`, "category join failed — fetch
without it") — so it doesn't crash, but the fallback branch fetches with no category at all. Net
effect, confirmed by tracing the fallback: **the products list shows zero category for all 887
products right now**, not just the ones missing `category_id`. This has been true since migration
067 added the second FK, however long ago that was live.

---

## b. Which pair should be canonical, and what changes either way

**Recommend: `category_id`/`product_type` (the legacy pair) stay the read source of truth.**
Reasoning, from the counts above, not preference:

- 866/887 products (97.6%) already have a real `category_id`; 870/887 (98.1%) already have a real
  `product_type`. The newer pair has real data for only 14/887 (1.6%) of products, and every one of
  those 14 duplicates a `category_id` that was already there. **Almost all real category/type data
  in this org lives in the legacy columns today.**
- Every current read site (products list, product detail, `resolveJobDepartments`) already reads
  the legacy pair. Recommending the legacy pair as canonical means **zero read-site changes** and
  **zero backfill required for read-correctness** — the data these reads need already exists for
  97-98% of products.
- The alternative (canonicalize on the newer pair) would require either a backfill covering 852-856
  products before switching any read site, or those reads returning nothing for the vast majority
  of products until backfilled — a strictly worse, higher-risk path for the exact same end state.

**What still has to change, either way:**
- The ambiguous-embed crash (above) needs an explicit FK hint no matter which pair wins —
  `product_categories!products_category_id_fkey(name)` if legacy stays canonical (matches this
  recommendation), `product_categories!products_product_category_id_fkey(name)` if not. This one
  line fixes the products list for all 866 already-categorized products immediately.
- `product-form.tsx` needs to write `category_id`/`product_type` going forward, not just
  `product_category_id`/`product_type_id` — right now it writes only the newer pair, which is what
  produced this whole split. The newer FK pair is worth keeping in sync too, not abandoned — it's
  structurally better for `product_type` (a real FK vs. free text) and the two settings pages
  already read it for delete-guard usage counts — so the recommended fix is to make the form write
  **both** pairs together on every save, not to stop writing the new one.
- **Not part of this fix, flagged as a separate, later decision**: the real reason the embed can
  ever be ambiguous is that two FKs to the same table coexist at all. The durable fix is dropping
  whichever column loses; not proposed here since that's a schema change with its own blast radius
  and this is scoped to the write/read split specifically.

---

## c. Every read site of all four columns, file:line

**`category_id`** (legacy FK → `product_categories`):
- Written: `product-form.tsx:156` (pass-through only — read into form state from the existing row,
  no `onChange` anywhere sets it — confirmed again this pass, zero setters); `actions.ts:134`
  (`category_id: data.category_id`, writes whatever the pass-through carried, `null` for a genuinely
  new product); `products/[id]/migrate/actions.ts:243,291`; `products/import/actions.ts` /
  `api/products/bulk-import-shopvox/route.ts:153` (CSV/ShopVOX import, legacy pair only).
- Read: `products/page.tsx:62,73-86,92` (list — currently broken for everyone, see above);
  `products/[id]/page.tsx:49,57,74-78` (detail page, category name lookup); `resolve-departments.ts:34,40`
  (job department assignment on quote→job conversion).

**`product_type`** (legacy `text`, no FK):
- Written: same sites as `category_id` above (`product-form.tsx:154` pass-through,
  `actions.ts:132`, migrate/import paths).
- Read: `products/page.tsx:62,93` (list "Type" column and its filter), `products-list-client.tsx:213,230,320,544-545`.

**`product_category_id`** (newer FK → `product_categories`):
- Written: `product-form.tsx:664` (the only real `<select>`), `actions.ts:135`.
- Read: **only** `settings/product-categories/product-categories-list-client.tsx:178-186` (usage
  count) and `settings/product-categories/actions-sr.ts:50` (delete-guard `.eq('product_category_id', id)`)
  — never rendered as the product's actual category anywhere a user or a production process reads it.

**`product_type_id`** (newer FK → `product_types`):
- Written: `product-form.tsx:650` (the only real `<select>`), `actions.ts:133`.
- Read: **only** `settings/product-types/page.tsx:77-86` (usage count) and
  `settings/product-types/actions-sr.ts:46` (delete-guard) — same shape as above.

**Ruled out as false leads, checked directly**: `product_type_id` also appears in
`material-form.tsx`, `units-of-business-select.tsx`, and `materials/[id]/page.tsx` — that's a
**different column on a different table** (`material_product_types.product_type_id`, the
materials-side "Units of Business" junction from the earlier investigation) — unrelated to this
bug, confirmed by reading each site, not just the grep match.

**Confirms the full blast radius is exactly three read sites that matter** (products list, product
detail, job-department resolution) plus one write site (`product-form.tsx`/`actions.ts`) — nothing
else in the app reads either the legacy or the newer pair for anything beyond delete-guard counts.

---

## d. Backfill — needed, and how safely

**Not required for the recommended fix** (canonicalize reads on the legacy pair) — 97-98% of
products already have the data the reads need, and the fix doesn't touch any read site's target
columns.

**Worth doing later, for the newer pair's own correctness** (used only for delete-guard counts
today, so low urgency) — checked exactly how safely each direction backfills:

- **Category**: `product_category_id = category_id` wherever `category_id` is set and
  `product_category_id` isn't (852 products) — **fully safe, mechanical, no ambiguity**. Both
  columns are FKs to the literal same `product_categories` table; this is a direct id copy, not a
  match/guess.
- **Type**: `product_type_id` from `product_type` (text) needs a name match against
  `product_types.name` — **not uniformly safe**. Checked every distinct `product_type` value (14
  distinct strings across 870 products) against `product_types.name`: **9 of 14 match exactly**
  (safe, mechanical) — the other **5 do not match any `product_types` row at all**:
  `"Promotional/ Outsource"`, `"Fleets/ Vehicle Wraps"` (both off-by-one-space from the real seeded
  names, `"Promotional / Outsource"` / `"Fleets / Vehicle Wraps"` — migration 067's seed data), and
  `"large_format"`, `"vehicle_wrap"`, `"commercial_print"` (snake_case codes from what looks like an
  older, different naming generation, no current `product_types` row resembling them at all). **These
  5 need your decision, not an automated guess** — either which real `product_types` row each maps
  to, or whether they're stale and should be re-typed from scratch. Not resolved here.

---

## Files touched this session

None. Report only. Scratch scripts that queried the database (`scripts/_tmp_products_category_split.mjs`,
`scripts/_tmp_check_ambiguous_join.mjs`) have been deleted.

**Waiting for your read before proposing the fix, per instruction.**

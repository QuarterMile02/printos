# Stage 0 fix — products category/type write/read split

Branch: `fix-products-category-type-split` (off `main`; not pushed to `main`). Org:
`4ca12dff-97be-4472-8099-ab102a3af01a`. **No migration** — both fixes are pure application code,
no schema change.

Full investigation and reasoning: `known-issues/2026-08-24-products-category-type-split-report.md`
(delivered and read before this build started, per instruction). Deliberate follow-up work tracked
separately: `known-issues/2026-08-24-products-category-type-dual-write-followup.md`.

## Order, as instructed: urgent read-side fix first, verified live, before touching the write side

### 1. The read-side fix — `products/page.tsx`

The products list's `product_categories` embed had no FK qualifier. Two FKs now exist from
`products` to `product_categories` (`category_id`, `product_category_id`), so the embed is
structurally ambiguous — PostgREST refuses it (`PGRST201`), and the page's own defensive fallback
silently drops category entirely rather than crash. Fixed with an explicit FK hint:
`product_categories!products_category_id_fkey(name)` — one line, no other change to the query
shape or the existing fallback.

**Verified live, before touching the write side, exactly as instructed** — ran both the old
(unqualified) and new (FK-hinted) query against production:

| | Before | After |
|---|---|---|
| Query result | `PGRST201: Could not embed because more than one relationship was found` | Succeeds |
| Products showing a category on the list | **0 of 887** | **866 of 887** |

The remaining 21 have no `category_id` at all (confirmed in the investigation report — genuinely
uncategorized, not a bug this fix touches). This is a real, currently-broken, org-wide read
repaired — not masked by the write-side change below, which came after this was already confirmed
live.

### 2. The write-side fix — `product-form.tsx`

The two live dropdowns (`Product Type`, `Product Category`) previously wrote only
`product_type_id`/`product_category_id`. Now each selection dual-writes:
- **Type**: `product_type_id` (the dropdown's own value) **and** `product_type` (the matching
  `name` from the same already-loaded `productTypes` list — not a separate lookup or a guess).
- **Category**: `product_category_id` **and** `category_id` (a direct id copy — both are FKs to
  the literal same `product_categories` table, so they cannot disagree once both are set this way).

No change needed in `actions.ts` — `buildRecord()` already passes through all four fields from
form state; it was only ever missing values because the form never set two of them.

**Marked explicitly as a bridge, not the destination**, per instruction — inline comments at both
write sites say so directly, and
`known-issues/2026-08-24-products-category-type-dual-write-followup.md` records the real follow-up
(collapse to one column per concept, migrate every read site, backfill, drop the losing column and
this dual-write) as deliberate, tracked, not-forgotten work — not proposed or built in this PR.

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint` on both touched files — clean (one pre-existing warning and one pre-existing set of
  `<a>`-vs-`<Link>` errors on `product-form.tsx`/`page.tsx` respectively, confirmed present
  identically on unmodified `main` via `git stash`, unrelated to this change).
- `npm run build` — succeeds, full production build.
- Live before/after on the products list, above — the actual thing asked to be verified against
  real rows, not a green build.

## What this does NOT touch, confirmed unchanged

- `resolveJobDepartments()` — untouched. It already correctly reads `category_id`; once a new
  product is saved through the fixed form, `category_id` is now populated, so department resolution
  starts working for new products without needing its own code change.
- The two settings-page delete-guard/usage-count queries (`product-types/page.tsx`,
  `product-categories-list-client.tsx`) — untouched, still read `product_type_id`/
  `product_category_id`, which is correct for their purpose (counting real FK references).
- No backfill of the 852-856 existing products missing the newer pair — not needed for this fix
  (per the investigation report's reasoning) and not attempted here.
- No schema change, no `DROP COLUMN`, no migration file — the actual column collapse is the tracked
  follow-up, deliberately not this PR.

## Files in this PR

- `src/app/(dashboard)/dashboard/[slug]/products/page.tsx` — the FK-hint fix.
- `src/app/(dashboard)/dashboard/[slug]/products/product-form.tsx` — the dual-write fix.
- `known-issues/2026-08-24-products-category-type-dual-write-followup.md` — the follow-up note.
- This report.

No scratch scripts left over (the live before/after verification script read
`SUPABASE_SERVICE_ROLE_KEY` and has been deleted).

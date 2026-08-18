# 2026-08-17 — Portal Tiers: 3 real code paths broken by RLS with zero policies

## Status

**Open, not fixed.** Found during migration-drift cleanup (checking `portal_tiers` /
`portal_tier_discounts` into version control — see `supabase/migrations/146_portal_tiers_table.sql`
and `147_portal_tier_discounts_table.sql`). This write-up captures the finding for
prioritization; no fix has been built yet.

## Summary

`portal_tiers` and `portal_tier_discounts` both have Row Level Security **enabled with
zero policies** (confirmed via `select * from pg_policies where tablename in
('portal_tiers', 'portal_tier_discounts')` — zero rows for both). With RLS enabled and
no policies, Postgres denies all access to every role except `service_role` (which has
`BYPASSRLS`).

Only one of the four real code paths that touch these tables was written to work around
this (using `createServiceClient()`, with a code comment showing the author already hit
the wall once). The other three were not, and are consequently non-functional or
silently degraded in production today for every real authenticated user (staff or
future portal contact) — this was never caught because each one fails quietly rather
than with a visible error in the UI.

## The 4 code paths

| # | File | Operation | Client used | Result today |
|---|---|---|---|---|
| 1 | `src/app/api/portal-tiers/route.ts` | GET/POST — list tiers, seed 5 defaults, create tier | `createServiceClient()` (explicit comment: *"Use service client so SELECT + INSERT are not blocked by RLS edge cases"*) | **Works.** |
| 2 | `src/app/api/portal-tiers/[id]/route.ts` | PATCH (rename/toggle active), DELETE (soft-delete via `is_active: false`) | plain cookie-bound client (`getClient()`, anon key + session cookies) | **Broken.** `UPDATE ... RETURNING` matches 0 rows (RLS hides the row from this session), `.select().single()` then errors "JSON object requested, multiple (or no) rows returned" → route returns 500. |
| 3 | `src/app/api/portal-tiers/[id]/discounts/route.ts` | GET (list discount rows), PUT (replace all rows for a tier: delete + insert) | plain cookie-bound client | **Broken.** GET silently returns `[]` (no error — reads as "no discounts configured", not "broken"). DELETE silently affects 0 rows (no error). INSERT of any row with `discount_percent > 0` throws a genuine RLS-violation error → 500. |
| 4 | `src/app/(dashboard)/dashboard/[slug]/customers/[customerId]/page.tsx` (lines ~87–97) | reads `portal_tiers` to populate the "Pricing Tier" `<select>` on the customer detail page | plain cookie-bound client (`createClient()`), wrapped in `try { ... } catch { /* migration 097 not yet applied */ }` | **Silently broken.** The query succeeds with 0 rows (RLS filters, doesn't throw), so the stale catch comment never even triggers. `portalTiers` is always `[]` — the dropdown only ever shows "— No tier assigned —", real tiers never appear as options. |

Row 5 for completeness: `customer-detail-client.tsx` / `customers/actions.ts` only read/write
`customers.portal_tier_id` (a plain column on `customers`), not `portal_tiers` itself — separate
RLS surface, not affected by this gap.

## User-visible impact

- **Settings → Portal Tiers page:** renaming a tier or deactivating one fails (500).
  Creating a new tier and the initial list both work (path #1).
- **Tier discount configuration:** appears to always have zero discounts configured,
  and saving any non-zero discount fails outright (500). This sub-feature is
  effectively unusable today.
- **Customer detail page → Pricing Tier field:** the dropdown never has any tiers to
  choose from, regardless of how many exist for the org. Every customer looks like it
  has "no tier assigned" as a selectable option, even though `portal_tier_id` itself
  (once set some other way) still displays correctly as plain text in the read-only
  view.

## Root cause

Same shape as every other table in this session's RLS work: whoever added RLS to
`portal_tiers`/`portal_tier_discounts` never added any policies to go with it, and no
one code path was consistently used across the feature. Path #1 was written or patched
by someone who hit this and switched to service-role instead of fixing the missing
policy; paths #2–#4 predate that patch, or were added after it without the same fix
being applied consistently.

## Fix options (not decided, not built)

1. Add real RLS policies scoped to org members (`organization_id in (select
   organization_id from organization_members where user_id = auth.uid())`), matching
   the pattern already used for `quotes`/`sales_orders`/`invoices`/`payments`. Fixes it
   at the data layer — every current and future code path benefits, including any portal-contact-facing use later.
2. Switch paths #2–#4 to `createServiceClient()`, matching path #1. Faster, but extends
   the inconsistent workaround rather than resolving it, and does nothing for any
   future portal-contact-facing read of these tables (a portal contact viewing their
   own tier/discounts, if that's ever built, would hit the same wall with no
   service-role code path to fall back on).

Option 1 is the more durable fix and consistent with how every other table in the
Customer Portal RLS plan was handled — flagging as the likely direction, not deciding
here.

## Related

- `supabase/migrations/146_portal_tiers_table.sql`, `147_portal_tier_discounts_table.sql`
  — document current RLS state (enabled, zero policies) exactly as found; do not add a
  policy without updating this doc and re-verifying against `pg_policies`.
- `supabase/migrations/137`–`142` — the Customer Portal RLS plan for
  quotes/sales_orders/invoices/payments, same "RLS enabled, needs an explicit org-member
  policy" shape, already fixed for those four tables.

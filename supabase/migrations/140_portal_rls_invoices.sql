-- ============================================================
-- Migration 140: Customer Portal RLS -- invoices (step 6, table 3 of 4)
-- Applied: PENDING — run manually in the Supabase SQL Editor (Ruben),
--   not auto-applied by Claude Code. See chat for context.
-- ============================================================
--
-- Build plan rev. 2, step 6. quotes (137) and sales_orders (139) are
-- done and re-verified with real authenticated sessions; the
-- customer_contacts self-read dependency (138) already covers this
-- table too -- no new gap expected, still verifying that for real
-- rather than assuming it, same as every table in this plan.
--
-- Introspection done before writing this (same approach as
-- quotes/sales_orders):
--   1. Migration history: single source of truth this time, like
--      quotes -- only 026_invoices.sql ever defines RLS on invoices
--      (inv_select_members, inv_insert_non_viewers,
--      inv_update_non_viewers, all org-member-scoped via auth.uid()).
--      No duplicate/redundant second migration the way sales_orders
--      had (018b + 020). Also notable: no DELETE policy exists on
--      invoices at all -- invoices aren't deletable through RLS,
--      consistent with normal accounting-record integrity. Not
--      relevant to this portal SELECT policy either way.
--   2. Live behavioral check: an unauthenticated anon-key read against
--      invoices returned 0 rows/count, while a service-role read saw
--      the real 2 rows (this org only has 2 invoices today -- noting
--      that for context, not a red flag). RLS is genuinely enabled and
--      enforced. Confirmed invoices has a customer_id column, matching
--      the policy shape below.
--
-- Second, independent policy -- OR-ed alongside the existing
-- org-member one, not merged into it. Same locked architectural
-- decision as quotes and sales_orders.
--
-- Read-only, same as quotes/sales_orders -- no INSERT/UPDATE for
-- portal contacts (there's no DELETE to begin with), deferred to a
-- future ordering/approval/payment phase.

CREATE POLICY "portal contacts can view their own customer's invoices"
  ON invoices FOR SELECT
  USING (
    customer_id IN (
      SELECT customer_id FROM customer_contacts
      WHERE portal_user_id = auth.uid()
    )
  );

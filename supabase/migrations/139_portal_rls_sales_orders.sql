-- ============================================================
-- Migration 139: Customer Portal RLS -- sales_orders (step 6, table 2 of 4)
-- Applied: PENDING — run manually in the Supabase SQL Editor (Ruben),
--   not auto-applied by Claude Code. See chat for context.
-- ============================================================
--
-- Build plan rev. 2, step 6. quotes (migration 137) is done and
-- re-verified with real authenticated sessions after fixing the
-- customer_contacts self-read dependency (migration 138). Same
-- dependency already covers sales_orders -- no new gap expected here,
-- but re-verifying with a real session rather than assuming that,
-- same as every table in this plan.
--
-- Introspection done before writing this (same two-check approach as
-- quotes, still no direct SQL/catalog access -- PostgREST doesn't
-- expose pg_policies):
--   1. Migration history: found something worth flagging, not just
--      the clean single-source-of-truth quotes had. TWO migrations
--      define RLS on sales_orders -- 018b_quotes_phase_8.sql (named
--      policies like "org members can view sales_orders") AND
--      020_sales_orders_ensure.sql (differently-named policies like
--      so_select_members), the latter explicitly written as an
--      idempotent "ensure" migration because whoever wrote it didn't
--      know whether 018b had already applied ("Migration 018b may or
--      may not have been applied, so use IF NOT EXISTS throughout").
--      Because the policy NAMES differ between the two files, 020's
--      "CREATE POLICY ... EXCEPTION WHEN duplicate_object THEN NULL"
--      guard only protects against re-running 020 itself -- it would
--      NOT have skipped creating so_select_members even if 018b's
--      "org members can view sales_orders" already existed. If both
--      migrations genuinely ran, sales_orders likely has redundant
--      (not conflicting -- structurally identical org-member-scoped
--      USING clauses) SELECT/INSERT/UPDATE/DELETE policies today.
--      Not fixing that cleanup here -- out of scope for this pass, and
--      redundant permissive policies don't change correctness, only
--      tidiness. Flagging it since introspection is supposed to
--      surface exactly this kind of thing, not paper over it.
--   2. Live behavioral check: an unauthenticated anon-key read against
--      sales_orders returned 0 rows/count, while a service-role read
--      saw the real 6 rows. RLS is genuinely enabled and enforced
--      today. Also confirmed sales_orders has a customer_id column,
--      matching the policy shape below.
--
-- Second, independent policy -- OR-ed alongside whichever existing
-- org-member policy/policies are actually live, not merged into any
-- of them. Same locked architectural decision as quotes.
--
-- Read-only, same as quotes -- no INSERT/UPDATE/DELETE for portal
-- contacts, deferred to a future ordering/approval phase.

CREATE POLICY "portal contacts can view their own customer's sales orders"
  ON sales_orders FOR SELECT
  USING (
    customer_id IN (
      SELECT customer_id FROM customer_contacts
      WHERE portal_user_id = auth.uid()
    )
  );

-- ============================================================
-- Migration 137: Customer Portal RLS -- quotes (step 6, table 1 of 4)
-- Applied: PENDING — run manually in the Supabase SQL Editor (Ruben),
--   not auto-applied by Claude Code. See chat for context.
-- ============================================================
--
-- Build plan rev. 2, step 6. This is the step that actually makes
-- portal accounts see real data -- until now a logged-in contact just
-- got a bare landing page (build plan step 3), nothing exposed or
-- protected. Doing this one table at a time, quotes first, with real
-- verification after each before moving to the next.
--
-- Introspection done before writing this (no direct SQL/catalog access
-- available -- PostgREST doesn't expose pg_policies, confirmed live,
-- same limitation noted verifying migration 134). Two independent
-- checks, not one:
--   1. Migration history: the ONLY place quotes' RLS was ever defined
--      is migration 002_quotes.sql -- 4 policies (select/insert/
--      update/delete), all scoped through organization_members via
--      auth.uid(). Grepped every migration touching "quotes" (30
--      files) for anything that further touches its RLS (DROP POLICY,
--      re-CREATE, ENABLE/DISABLE) -- nothing since 002 ever has.
--   2. Live behavioral check: an unauthenticated anon-key read against
--      quotes returned 0 rows/count, while a service-role read (which
--      bypasses RLS entirely) saw the real 18 rows. Confirms RLS is
--      genuinely enabled and enforced today, not just declared in a
--      migration that may not have actually landed (schema drift has
--      been real elsewhere in this codebase -- payment_gateway_settings,
--      portal_tiers, sms_settings, payments' own CREATE TABLE were all
--      found live but missing from checked-in migrations).
-- If you want the exact current policy list beyond this, run this
-- first and eyeball the output before the CREATE POLICY below:
--   SELECT polname, cmd, qual FROM pg_policy
--   JOIN pg_class ON pg_class.oid = pg_policy.polrelid
--   WHERE pg_class.relname = 'quotes';
--
-- Second, INDEPENDENT policy -- OR-ed alongside the existing org-member
-- one, not merged into a single combined clause. Locked architectural
-- decision from the original build plan: two separate policies stay
-- auditable on their own (`SELECT * FROM pg_policies WHERE tablename =
-- 'quotes'` shows exactly "staff can see X" and "portal contacts can
-- see Y" as two distinct, individually-droppable rows), where a single
-- cleverly-OR-ed clause would hide that distinction and be harder to
-- reason about or revoke independently later.
--
-- Read-only. No INSERT/UPDATE/DELETE policy for portal contacts on this
-- table -- out of scope here, deferred to a future ordering/approval
-- phase per the original plan (build plan step 3's comments on
-- acceptInvite()/portalSignIn() already establish this posture: portal
-- reads go through service-role code today specifically because no RLS
-- exists yet for a portal session to read anything on its own; this is
-- the first table where that changes).

CREATE POLICY "portal contacts can view their own customer's quotes"
  ON quotes FOR SELECT
  USING (
    customer_id IN (
      SELECT customer_id FROM customer_contacts
      WHERE portal_user_id = auth.uid()
    )
  );

-- ============================================================
-- Migration 148: portal_tiers / portal_tier_discounts -- add real
-- org-member RLS policies (currently zero policies on both, per
-- migrations 146/147 and the pg_policies check that found them).
--
-- Scope decision (locked, 2026-08-17): RLS stays at plain
-- org-membership -- same shape as every other "org members can view/
-- manage X" policy in this codebase (quotes/sales_orders/invoices/
-- payments). Fine-grained "which staff role" gating
-- (portal_tiers.manage, sales-manager or accounting-manager only)
-- lives at the application layer via checkPermission(), not
-- duplicated here in SQL -- avoids reimplementing hasPermission()'s
-- override -> role+tier -> tier -> role-default resolution logic a
-- second time in Postgres, which would drift out of sync with the
-- real source of truth (src/lib/permissions.ts).
--
-- In practice, the 3 code paths that write to these tables already
-- go through checkPermission(orgId, 'portal_tiers.manage') before
-- ever reaching the database, and use createServiceClient() (which
-- bypasses RLS) to perform the actual read/write -- so these
-- policies exist for defense-in-depth / any future code path that
-- uses a normal authenticated client instead of service-role, not as
-- the primary enforcement mechanism.
-- ============================================================

drop policy if exists "org members can manage portal tiers" on public.portal_tiers;
create policy "org members can manage portal tiers"
  on public.portal_tiers for all
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  )
  with check (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

drop policy if exists "org members can manage portal tier discounts" on public.portal_tier_discounts;
create policy "org members can manage portal tier discounts"
  on public.portal_tier_discounts for all
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  )
  with check (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

-- ============================================================
-- Migration 147: portal_tier_discounts -- reconstruct CREATE TABLE
-- (schema drift). Documentation only -- already live, IF NOT EXISTS
-- is a no-op against production. Never checked into either migrations
-- directory before.
--
-- Columns confirmed via a real insert-and-return-full-row probe
-- (service-role, throwaway row, deleted immediately after): id,
-- organization_id, tier_id, unit_of_business, product_type,
-- discount_percent, created_at. Explicit error confirmed no
-- updated_at. discount_percent's exact numeric type is INFERRED
-- (numeric, matching customers.discount_percent's naming convention
-- elsewhere in this schema) -- not independently confirmed via
-- catalog access.
--
-- RLS: confirmed via pg_policies -- ZERO rows, same as portal_tiers.
-- Enabled, no policies, reproduced exactly -- not invented. See
-- known-issues/2026-08-17-portal-tiers-rls-gap.md for the related
-- finding: the only code path that touches this table
-- (api/portal-tiers/[id]/discounts/route.ts, GET+PUT) uses a normal
-- authenticated client, never service-role -- so this table's entire
-- feature (viewing/editing tier discounts) is non-functional under
-- this RLS today. Not fixed here.
-- ============================================================

create table if not exists public.portal_tier_discounts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  tier_id           uuid not null references portal_tiers(id) on delete cascade,
  unit_of_business  text,
  product_type      text,
  discount_percent  numeric, -- inferred type, not catalog-confirmed
  created_at        timestamptz not null default now()
);

grant select, insert, update, delete on public.portal_tier_discounts to authenticated;
grant select, insert, update, delete on public.portal_tier_discounts to service_role;

-- RLS enabled, deliberately zero policies -- matches live reality
-- exactly.
alter table public.portal_tier_discounts enable row level security;

-- ============================================================
-- Migration 146: portal_tiers -- reconstruct CREATE TABLE (schema drift)
-- Documentation only -- already live, IF NOT EXISTS is a no-op against
-- production. Never checked into either migrations directory before.
--
-- Columns confirmed via real data + explicit "column does not exist"
-- error confirming there's no updated_at: id, organization_id, name,
-- is_active, created_at.
--
-- RLS: confirmed via `select * from pg_policies where tablename =
-- 'portal_tiers'` (Ruben, SQL Editor) -- ZERO rows. RLS is enabled but
-- has NO policies at all, meaning Postgres denies every read/write to
-- every role except service_role (which has BYPASSRLS). This is
-- reproduced EXACTLY below -- no policy is invented here. See
-- known-issues/2026-08-17-portal-tiers-rls-gap.md for the related
-- finding: only one of the four real code paths that touch this table
-- actually uses service-role; the other three (tier rename/deactivate,
-- discount management, customer-detail tier dropdown) use a normal
-- authenticated client and are consequently non-functional under this
-- RLS today. Not fixed by this migration -- flagged separately, fix TBD.
-- ============================================================

create table if not exists public.portal_tiers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  is_active       boolean default true,
  created_at      timestamptz not null default now()
);

grant select, insert, update, delete on public.portal_tiers to authenticated;
grant select, insert, update, delete on public.portal_tiers to service_role;

-- RLS enabled, deliberately zero policies -- matches live reality
-- exactly. Do not add a policy here without confirming it against
-- pg_policies first; adding one would make this file diverge from
-- what's actually live.
alter table public.portal_tiers enable row level security;

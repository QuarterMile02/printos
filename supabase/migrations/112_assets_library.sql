-- ============================================================
-- Migration 112: Assets File Library
-- Applied: 2026-08-05
-- ============================================================
--
-- Reusable file/attachment library: org members upload PDFs/images/docs,
-- organize them into a small set of renameable categories, and select
-- them as attachments anywhere PrintOS sends something to a customer
-- (starting with the Quote send-email flow).
--
-- Files themselves live in Supabase Storage (private `assets` bucket,
-- created lazily in the upload server action, same pattern as the
-- existing `proofs` bucket) -- these tables hold metadata + the
-- storage path only.
--
-- Categories are a small fixed-shape set per org (seeded with 3
-- generic placeholders below), renameable but not intended to be
-- freely added/removed -- no separate "create category" flow.

create table if not exists public.asset_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

grant select                         on public.asset_categories to anon;
grant select, insert, update, delete on public.asset_categories to authenticated;
grant select, insert, update, delete on public.asset_categories to service_role;

alter table public.asset_categories enable row level security;

drop policy if exists "asset_categories_select" on public.asset_categories;
create policy "asset_categories_select" on public.asset_categories for select
  using (organization_id in (select organization_id from organization_members where user_id = auth.uid()));

drop policy if exists "asset_categories_insert" on public.asset_categories;
create policy "asset_categories_insert" on public.asset_categories for insert
  with check (organization_id in (select organization_id from organization_members where user_id = auth.uid() and role != 'viewer'));

drop policy if exists "asset_categories_update" on public.asset_categories;
create policy "asset_categories_update" on public.asset_categories for update
  using (organization_id in (select organization_id from organization_members where user_id = auth.uid() and role != 'viewer'));

drop policy if exists "asset_categories_delete" on public.asset_categories;
create policy "asset_categories_delete" on public.asset_categories for delete
  using (organization_id in (select organization_id from organization_members where user_id = auth.uid() and role in ('owner', 'admin')));

create index if not exists idx_asset_categories_org on public.asset_categories(organization_id);


create table if not exists public.assets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  category_id     uuid references asset_categories(id) on delete set null,
  name            text not null,
  file_name       text not null,
  storage_path    text not null,
  mime_type       text not null,
  file_size       bigint not null default 0,
  uploaded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

grant select                         on public.assets to anon;
grant select, insert, update, delete on public.assets to authenticated;
grant select, insert, update, delete on public.assets to service_role;

alter table public.assets enable row level security;

drop policy if exists "assets_select" on public.assets;
create policy "assets_select" on public.assets for select
  using (organization_id in (select organization_id from organization_members where user_id = auth.uid()));

drop policy if exists "assets_insert" on public.assets;
create policy "assets_insert" on public.assets for insert
  with check (organization_id in (select organization_id from organization_members where user_id = auth.uid() and role != 'viewer'));

drop policy if exists "assets_update" on public.assets;
create policy "assets_update" on public.assets for update
  using (organization_id in (select organization_id from organization_members where user_id = auth.uid() and role != 'viewer'));

drop policy if exists "assets_delete" on public.assets;
create policy "assets_delete" on public.assets for delete
  using (organization_id in (select organization_id from organization_members where user_id = auth.uid() and role != 'viewer'));

create index if not exists idx_assets_org on public.assets(organization_id);
create index if not exists idx_assets_category on public.assets(category_id);


-- Seed 3 renameable placeholder categories for every existing org.
-- ON CONFLICT guard via a name+org existence check so this is safe to
-- re-run and doesn't duplicate categories an org has already renamed.
do $$
declare
  org record;
begin
  for org in select id from organizations loop
    if not exists (select 1 from asset_categories where organization_id = org.id) then
      insert into asset_categories (organization_id, name, sort_order) values
        (org.id, 'General', 0),
        (org.id, 'Templates', 1),
        (org.id, 'Branding', 2);
    end if;
  end loop;
end $$;

-- Migration 067: Product Types and Product Categories management
-- Creates product_types table, enriches product_categories, adds FK columns to products

-- ============================================================
-- 1. product_types table
-- ============================================================
create table if not exists public.product_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name            text not null,
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz default now()
);

create unique index if not exists product_types_org_name_uq
  on public.product_types(organization_id, name);

grant select                          on public.product_types to anon;
grant select, insert, update, delete  on public.product_types to authenticated;
grant select, insert, update, delete  on public.product_types to service_role;

alter table public.product_types enable row level security;

create policy "org members can view product types"
  on public.product_types for select
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "owners can manage product types"
  on public.product_types for all
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid() and role = 'owner'
    )
  );

-- ============================================================
-- 2. product_categories — add new managed columns
-- ============================================================
alter table public.product_categories
  add column if not exists product_type_id uuid references public.product_types(id),
  add column if not exists sort_order      int not null default 0,
  add column if not exists is_active       boolean not null default true;

-- ============================================================
-- 3. products — add new FK columns
-- ============================================================
alter table public.products
  add column if not exists product_type_id     uuid references public.product_types(id),
  add column if not exists product_category_id uuid references public.product_categories(id);

-- ============================================================
-- 4. Seed product_types for all existing organizations
-- ============================================================
insert into public.product_types (organization_id, name, sort_order)
select
  o.id,
  v.name,
  v.sort_order
from public.organizations o
cross join (values
  ('Signs / Large Format Printing', 10),
  ('Fleets / Vehicle Wraps',        20),
  ('Illuminated Signs',             30),
  ('Electrical',                    40),
  ('Apparel',                       50),
  ('Branding',                      60),
  ('Commercial Printing',           70),
  ('Digital Advertising',           80),
  ('Digital Marketing',             90),
  ('Direct Mail',                   100),
  ('Material Resale',               110),
  ('Promotional / Outsource',       120),
  ('Asset',                         130)
) as v(name, sort_order)
on conflict (organization_id, name) do nothing;

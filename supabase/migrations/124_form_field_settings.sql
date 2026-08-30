-- ============================================================
-- Migration 124: Forms Visibility Settings
-- Applied: NOT YET APPLIED — proposed only, paste into Supabase SQL editor to run
-- ============================================================
--
-- Per-field visibility/required toggles for each PrintOS form type,
-- mirroring ShopVOX's Settings > Forms page ("Toggle the visibility and
-- requiredness of fields across forms"). One row per (organization,
-- form_type, field_key). Covers all 10 form types ShopVOX itself
-- configures -- Quote, Invoice, Job, Sales Order, Customer, Material,
-- Vendor, Purchase Order, Product, Sales Lead (Product/Sales Lead were
-- initially out of the named scope but confirmed in).
--
-- This migration only creates the table -- QMI's actual live ShopVOX
-- config (captured directly from https://express.shopvox.com/settings/
-- forms/* across all 10 forms) is transferred in via a separate seed
-- migration once field_key mapping to PrintOS's own existing form
-- fields is confirmed (in progress -- see the field-mapping report
-- accompanying this migration; not run yet either).

create table if not exists public.form_field_settings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  form_type       text not null,
  field_key       text not null,
  field_label     text not null,
  is_visible      boolean not null default true,
  is_required     boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint form_field_settings_form_type_check
    check (form_type in (
      'quote', 'invoice', 'job', 'sales_order', 'customer',
      'material', 'vendor', 'purchase_order', 'product', 'sales_lead'
    )),
  -- Required implies visible -- matches ShopVOX's own UI, which grays
  -- out the Required checkbox whenever Visible is unchecked. A field
  -- can't be hidden from the form and simultaneously mandatory on it.
  constraint form_field_settings_required_implies_visible
    check (not is_required or is_visible),
  unique (organization_id, form_type, field_key)
);

-- Grants (required — Supabase no longer auto-grants as of May 2026)
grant select                         on public.form_field_settings to anon;
grant select, insert, update, delete on public.form_field_settings to authenticated;
grant select, insert, update, delete on public.form_field_settings to service_role;

alter table public.form_field_settings enable row level security;

drop policy if exists "form_field_settings_select" on public.form_field_settings;
create policy "form_field_settings_select" on public.form_field_settings for select
  using (organization_id in (select organization_id from organization_members where user_id = auth.uid()));

-- Insert/update/delete gated to owner/admin only (not "role != viewer"
-- like most settings tables) -- this setting changes what every user in
-- the org sees/must fill on every quote, job, invoice, etc., a higher
-- blast radius than most per-record settings tables carry.
drop policy if exists "form_field_settings_insert" on public.form_field_settings;
create policy "form_field_settings_insert" on public.form_field_settings for insert
  with check (organization_id in (select organization_id from organization_members where user_id = auth.uid() and role in ('owner','admin')));

drop policy if exists "form_field_settings_update" on public.form_field_settings;
create policy "form_field_settings_update" on public.form_field_settings for update
  using (organization_id in (select organization_id from organization_members where user_id = auth.uid() and role in ('owner','admin')));

drop policy if exists "form_field_settings_delete" on public.form_field_settings;
create policy "form_field_settings_delete" on public.form_field_settings for delete
  using (organization_id in (select organization_id from organization_members where user_id = auth.uid() and role in ('owner','admin')));

create index if not exists idx_form_field_settings_org_type on public.form_field_settings(organization_id, form_type);

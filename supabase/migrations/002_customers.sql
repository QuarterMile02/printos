-- ============================================================
-- PrintOS — Customers Table
-- ============================================================

create table customers (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  first_name       text not null,
  last_name        text not null,
  company_name     text,
  email            text,
  phone            text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================
-- Enable RLS
-- ============================================================

alter table customers enable row level security;

-- ============================================================
-- RLS Policies: customers
-- ============================================================

create policy "Org members can view customers"
  on customers for select
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = customers.organization_id
        and organization_members.user_id = auth.uid()
    )
  );

create policy "Org members can insert customers"
  on customers for insert
  with check (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = customers.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin', 'member')
    )
  );

create policy "Org members can update customers"
  on customers for update
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = customers.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin', 'member')
    )
  );

create policy "Owners and admins can delete customers"
  on customers for delete
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = customers.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin')
    )
  );

-- ============================================================
-- Trigger: keep updated_at current
-- ============================================================

create trigger set_customers_updated_at
  before update on customers
  for each row execute procedure set_updated_at();

-- ============================================================
-- Indexes
-- ============================================================

create index idx_customers_org_id    on customers(organization_id);
create index idx_customers_email     on customers(email);
create index idx_customers_created_at on customers(organization_id, created_at desc);

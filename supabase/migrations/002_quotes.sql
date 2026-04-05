-- ============================================================
-- PrintOS — Quotes & Quote Line Items
-- ============================================================

create type quote_status as enum ('draft', 'sent', 'approved', 'declined');

-- ============================================================
-- Tables
-- ============================================================

create table quotes (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  customer_id      uuid references customers(id) on delete set null,
  quote_number     integer not null,
  title            text not null,
  description      text,
  status           quote_status not null default 'draft',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table quote_line_items (
  id          uuid primary key default uuid_generate_v4(),
  quote_id    uuid not null references quotes(id) on delete cascade,
  description text not null,
  quantity    integer not null default 1,
  unit_price  integer not null default 0,  -- stored in cents
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Auto-increment quote_number per organization
create or replace function set_quote_number()
returns trigger
language plpgsql
as $$
begin
  new.quote_number := coalesce(
    (select max(quote_number) from quotes where organization_id = new.organization_id),
    0
  ) + 1;
  return new;
end;
$$;

create trigger set_quote_number_trigger
  before insert on quotes
  for each row execute procedure set_quote_number();

-- updated_at trigger (reuses existing function from 001)
create trigger set_quotes_updated_at
  before update on quotes
  for each row execute procedure set_updated_at();

-- ============================================================
-- Enable RLS
-- ============================================================

alter table quotes enable row level security;
alter table quote_line_items enable row level security;

-- ============================================================
-- RLS Policies: quotes
-- ============================================================

create policy "Members can view org quotes"
  on quotes for select
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = quotes.organization_id
        and organization_members.user_id = auth.uid()
    )
  );

create policy "Non-viewers can insert quotes"
  on quotes for insert
  with check (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = quotes.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin', 'member')
    )
  );

create policy "Non-viewers can update quotes"
  on quotes for update
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = quotes.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin', 'member')
    )
  );

create policy "Owners and admins can delete quotes"
  on quotes for delete
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = quotes.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin')
    )
  );

-- ============================================================
-- RLS Policies: quote_line_items
-- (access mirrors the parent quote via join)
-- ============================================================

create policy "Members can view quote line items"
  on quote_line_items for select
  using (
    exists (
      select 1 from quotes
      join organization_members on organization_members.organization_id = quotes.organization_id
      where quotes.id = quote_line_items.quote_id
        and organization_members.user_id = auth.uid()
    )
  );

create policy "Non-viewers can insert quote line items"
  on quote_line_items for insert
  with check (
    exists (
      select 1 from quotes
      join organization_members on organization_members.organization_id = quotes.organization_id
      where quotes.id = quote_line_items.quote_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin', 'member')
    )
  );

create policy "Non-viewers can update quote line items"
  on quote_line_items for update
  using (
    exists (
      select 1 from quotes
      join organization_members on organization_members.organization_id = quotes.organization_id
      where quotes.id = quote_line_items.quote_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin', 'member')
    )
  );

create policy "Non-viewers can delete quote line items"
  on quote_line_items for delete
  using (
    exists (
      select 1 from quotes
      join organization_members on organization_members.organization_id = quotes.organization_id
      where quotes.id = quote_line_items.quote_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin', 'member')
    )
  );

-- ============================================================
-- Indexes
-- ============================================================

create index idx_quotes_org_id on quotes(organization_id);
create index idx_quotes_customer_id on quotes(customer_id);
create index idx_quote_line_items_quote_id on quote_line_items(quote_id);

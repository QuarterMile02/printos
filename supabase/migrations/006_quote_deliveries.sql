-- ============================================================
-- PrintOS — Quote delivery log
-- ============================================================

create type delivery_method as enum ('email', 'sms', 'both');

create table quote_deliveries (
  id               uuid primary key default uuid_generate_v4(),
  quote_id         uuid not null references quotes(id) on delete cascade,
  organization_id  uuid not null references organizations(id) on delete cascade,
  method           delivery_method not null,
  sent_by          uuid not null references auth.users(id) on delete set null,
  recipient_email  text,
  recipient_phone  text,
  status           text not null default 'sent',
  created_at       timestamptz not null default now()
);

-- RLS
alter table quote_deliveries enable row level security;

create policy "Org members can view deliveries"
  on quote_deliveries for select
  using (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = quote_deliveries.organization_id
        and organization_members.user_id = auth.uid()
    )
  );

create policy "Org members can insert deliveries"
  on quote_deliveries for insert
  with check (
    exists (
      select 1 from organization_members
      where organization_members.organization_id = quote_deliveries.organization_id
        and organization_members.user_id = auth.uid()
        and organization_members.role in ('owner', 'admin', 'member')
    )
  );

-- Indexes
create index idx_quote_deliveries_quote on quote_deliveries(quote_id);
create index idx_quote_deliveries_org   on quote_deliveries(organization_id);

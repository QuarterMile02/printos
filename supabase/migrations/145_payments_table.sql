-- ============================================================
-- Migration 145: payments -- reconstruct CREATE TABLE (schema drift)
-- Documentation only -- this table is already live. IF NOT EXISTS
-- means running this against production does nothing. Written to
-- close the gap: payments' own CREATE TABLE was never checked into
-- either migrations directory (confirmed earlier this session), only
-- its RLS policies were (migrations 141, 142).
--
-- Columns confirmed via a real insert-and-return-full-row probe
-- (service-role, throwaway row, deleted immediately after):
--   id, organization_id, payment_number, customer_id, invoice_id,
--   amount_paid, payment_method, balance, applied, paid_on, note,
--   created_at, created_by
-- No catalog/SQL access available to confirm exact types/nullability/
-- defaults beyond what's directly observable from JSON + behavior.
-- Types below follow the same integer-cents-money convention used
-- everywhere else in this schema (quotes.total, invoices.total, etc.)
-- -- INFERRED, not independently confirmed. paid_on defaulting to
-- today's date on every insert this session strongly suggests
-- `default current_date`, also inferred. created_by nullable uuid,
-- shape matches profiles(id) by convention elsewhere -- inferred FK
-- target, not confirmed.
-- ============================================================

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  payment_number  integer not null,
  customer_id     uuid references customers(id),
  invoice_id      uuid references invoices(id),
  amount_paid     integer not null default 0, -- cents; inferred type
  payment_method  text,
  balance         integer default 0,          -- cents; inferred type
  applied         integer default 0,          -- cents; inferred type
  paid_on         date default current_date,  -- inferred default
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid references profiles(id) -- inferred FK target
);

grant select, insert, update, delete on public.payments to authenticated;
grant select, insert, update, delete on public.payments to service_role;

alter table public.payments enable row level security;

-- Two policies, already written and applied live this session
-- (migrations 141, 142) -- reproduced here so the CREATE TABLE and
-- its RLS live in the same reconstructed file. No INSERT/UPDATE/
-- DELETE policy for staff confirmed or tested -- out of scope,
-- same caveat as migration 142's own comments.

drop policy if exists "portal contacts can view their own customer's payments" on public.payments;
create policy "portal contacts can view their own customer's payments"
  on public.payments for select
  using (
    customer_id in (
      select customer_id from customer_contacts where portal_user_id = auth.uid()
    )
  );

drop policy if exists "org members can view payments" on public.payments;
create policy "org members can view payments"
  on public.payments for select
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

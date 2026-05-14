-- Migration 058: Add contact_id to quotes, sales_orders, jobs
-- Applied manually via Supabase SQL editor.
-- Safe to re-run — IF NOT EXISTS guards every statement.

alter table public.quotes
  add column if not exists contact_id uuid
    references public.customer_contacts(id) on delete set null;

alter table public.sales_orders
  add column if not exists contact_id uuid
    references public.customer_contacts(id) on delete set null;

alter table public.jobs
  add column if not exists contact_id uuid
    references public.customer_contacts(id) on delete set null;

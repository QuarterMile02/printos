-- ============================================================
-- Migration 077: Quote contact_name + seed customer_contacts
-- Applied: 2026-07-15
--
-- 1. Add contact_name (text) to quotes for freeform contact
--    entry when the contact is not in customer_contacts.
--    contact_id (UUID FK) already exists from migration 058.
--
-- 2. Seed one primary contact per customer from the customer's
--    own first_name / last_name / email / phone for every
--    customer that has no customer_contacts rows yet.
-- ============================================================

-- ── 1. quotes.contact_name ───────────────────────────────────────────────────

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS contact_name text;

-- ── 2. Seed primary contacts from customers ──────────────────────────────────
-- Only inserts where:
--   a) the customer has zero existing customer_contacts rows
--   b) the customer has at least a non-blank first or last name

INSERT INTO public.customer_contacts (
  customer_id,
  organization_id,
  full_name,
  first_name,
  last_name,
  email,
  phone,
  is_primary,
  is_active
)
SELECT
  c.id,
  c.organization_id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')),
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  true,
  true
FROM public.customers c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.customer_contacts cc
  WHERE cc.customer_id = c.id
)
AND TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) <> '';

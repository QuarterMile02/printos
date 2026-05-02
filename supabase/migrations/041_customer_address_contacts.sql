-- Customer detail expansion — Phase 1
--
-- Adds the address / account-info / status fields to the customers table
-- and creates the customer_contacts table for multi-contact support.
--
-- Type confirmations from the user:
--   taxable                     boolean  DEFAULT true
--   is_active                   boolean  DEFAULT true
--   allow_credit_card_payments  boolean  DEFAULT true
--   tax_exempt_expires          date     (nullable)
--   discount_percent            numeric  DEFAULT 0
--   terms                       text     DEFAULT '60/40'
--   credit_limit                numeric  DEFAULT 0
--   status                      text     DEFAULT 'lead'
--                               CHECK (status IN ('lead','sold','closable','prospect'))
--   everything else added below: text, nullable
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS and CREATE TABLE IF NOT EXISTS
-- so applying twice is safe. The status CHECK constraint is added in a
-- guarded DO block because Postgres has no IF NOT EXISTS on ADD CONSTRAINT.
-- Apply via the Supabase SQL editor.

-- ── 1. customers — new columns ──────────────────────────────────────────────

ALTER TABLE customers
  -- Primary address
  ADD COLUMN IF NOT EXISTS street     text,
  ADD COLUMN IF NOT EXISTS street2    text,
  ADD COLUMN IF NOT EXISTS city       text,
  ADD COLUMN IF NOT EXISTS state      text,
  ADD COLUMN IF NOT EXISTS zip        text,
  -- Secondary address (Ship To / Install)
  ADD COLUMN IF NOT EXISTS secondary_street text,
  ADD COLUMN IF NOT EXISTS secondary_city   text,
  ADD COLUMN IF NOT EXISTS secondary_state  text,
  ADD COLUMN IF NOT EXISTS secondary_zip    text,
  -- Account / lifecycle
  ADD COLUMN IF NOT EXISTS status         text    DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS industry       text,
  ADD COLUMN IF NOT EXISTS lead_source    text,
  ADD COLUMN IF NOT EXISTS sales_rep      text,
  ADD COLUMN IF NOT EXISTS customer_group text,
  ADD COLUMN IF NOT EXISTS legal_name     text,
  ADD COLUMN IF NOT EXISTS website        text,
  ADD COLUMN IF NOT EXISTS pricing_level  text,
  ADD COLUMN IF NOT EXISTS is_active                  boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_credit_card_payments boolean DEFAULT true,
  -- Tax + finance
  ADD COLUMN IF NOT EXISTS taxable            boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS tax_exempt_code    text,
  ADD COLUMN IF NOT EXISTS tax_exempt_expires date,
  ADD COLUMN IF NOT EXISTS terms              text    DEFAULT '60/40',
  ADD COLUMN IF NOT EXISTS credit_limit       numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_percent   numeric DEFAULT 0,
  -- Notes
  ADD COLUMN IF NOT EXISTS background_info text,
  ADD COLUMN IF NOT EXISTS special_notes   text;

-- Status CHECK — guarded so a re-run doesn't trip on duplicate constraint name.
-- NULLs pass any CHECK (predicate evaluates to UNKNOWN, not FALSE), so adding
-- the constraint after the column is safe even if some rows pre-date the DEFAULT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'customers'
      AND constraint_name = 'customers_status_check'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_status_check
      CHECK (status IN ('lead', 'sold', 'closable', 'prospect'));
  END IF;
END $$;

-- Helpful list-page filters
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_customers_city   ON customers(organization_id, city);

-- ── 2. customer_contacts — new table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  first_name      text,
  last_name       text,
  email           text,
  email2          text,
  phone           text,
  phone2          text,
  phone_ext       text,
  title           text,
  is_primary      boolean DEFAULT false,
  is_ap_contact   boolean DEFAULT false,
  is_active       boolean DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Dedup guard: UPSERT target. Partial index so multiple null emails per
-- customer are still allowed (a contact may have only a phone).
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_contacts_customer_email
  ON customer_contacts(customer_id, lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer
  ON customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_org
  ON customer_contacts(organization_id);

-- Keep updated_at fresh — reuses the set_updated_at function from 001
DROP TRIGGER IF EXISTS set_customer_contacts_updated_at ON customer_contacts;
CREATE TRIGGER set_customer_contacts_updated_at
  BEFORE UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ── 3. customer_contacts — RLS ──────────────────────────────────────────────

ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view customer_contacts"   ON customer_contacts;
DROP POLICY IF EXISTS "Org members can insert customer_contacts" ON customer_contacts;
DROP POLICY IF EXISTS "Org members can update customer_contacts" ON customer_contacts;
DROP POLICY IF EXISTS "Owners and admins can delete customer_contacts" ON customer_contacts;

CREATE POLICY "Org members can view customer_contacts"
  ON customer_contacts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = customer_contacts.organization_id
      AND om.user_id = auth.uid()
  ));

CREATE POLICY "Org members can insert customer_contacts"
  ON customer_contacts FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = customer_contacts.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin', 'member')
  ));

CREATE POLICY "Org members can update customer_contacts"
  ON customer_contacts FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = customer_contacts.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin', 'member')
  ));

CREATE POLICY "Owners and admins can delete customer_contacts"
  ON customer_contacts FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = customer_contacts.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('owner', 'admin')
  ));

-- Customer module overhaul — adds missing columns to customers table.
-- All statements use IF NOT EXISTS / guarded DO blocks so re-runs are safe.

ALTER TABLE customers
  -- address extras
  ADD COLUMN IF NOT EXISTS suburb              text,
  ADD COLUMN IF NOT EXISTS secondary_street2   text,
  ADD COLUMN IF NOT EXISTS secondary_suburb    text,
  ADD COLUMN IF NOT EXISTS label               text,
  ADD COLUMN IF NOT EXISTS attention_to        text,
  ADD COLUMN IF NOT EXISTS secondary_attention_to text,
  ADD COLUMN IF NOT EXISTS secondary_address_type text,
  ADD COLUMN IF NOT EXISTS address_type        text,
  -- contact extras
  ADD COLUMN IF NOT EXISTS ap_contact          text,
  ADD COLUMN IF NOT EXISTS phone_ext           text,
  -- finance extras
  ADD COLUMN IF NOT EXISTS vat_number          text,
  ADD COLUMN IF NOT EXISTS other_info          text,
  ADD COLUMN IF NOT EXISTS tags                text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS discount_id         uuid REFERENCES discounts(id) ON DELETE SET NULL,
  -- "verify exist" columns (these may not exist under these exact names)
  ADD COLUMN IF NOT EXISTS tax_exempt_expires_at date,
  ADD COLUMN IF NOT EXISTS payment_terms       text,
  ADD COLUMN IF NOT EXISTS sales_rep_id        uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Indexes for list-page performance
CREATE INDEX IF NOT EXISTS idx_customers_tags  ON customers USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_customers_name  ON customers(organization_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(organization_id, is_active);

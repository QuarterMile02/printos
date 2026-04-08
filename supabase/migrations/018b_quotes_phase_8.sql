-- Migration 018b: Quotes Phase 8 — remap data, add columns, sales_orders.
--
-- ⚠️ Run 018a FIRST and let it commit. This file references the new
-- enum values added there; running them in the same transaction throws
-- "unsafe use of new value of enum type".

-- ── Remap legacy statuses to the Phase 8 vocabulary ───────────────────
UPDATE quotes SET status = 'delivered' WHERE status = 'sent';
UPDATE quotes SET status = 'lost'      WHERE status = 'declined';

-- ── Quote columns ──────────────────────────────────────────────────────
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS subtotal integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS converted_to_so_id uuid;

-- needs_pricing_approval already added in 007_quotes_manager_flags.sql,
-- so skip it here to avoid clashing with the existing default.

-- ── Quote line item columns ───────────────────────────────────────────
ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS width numeric(10,4),
  ADD COLUMN IF NOT EXISTS height numeric(10,4),
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_price integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable boolean NOT NULL DEFAULT true;

-- ── Sales orders table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  so_number       integer NOT NULL,
  quote_id        uuid REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_process','completed','hold','no_charge','no_charge_approved','void')),
  notes           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, so_number)
);

-- The FK from quotes.converted_to_so_id back to sales_orders is added
-- here (after the table exists) so the column above didn't need to be
-- created in a specific order.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'quotes_converted_to_so_id_fkey'
  ) THEN
    ALTER TABLE quotes
      ADD CONSTRAINT quotes_converted_to_so_id_fkey
      FOREIGN KEY (converted_to_so_id) REFERENCES sales_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Auto-increment so_number per org (mirrors set_quote_number) ───────
CREATE OR REPLACE FUNCTION next_so_number(org_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE next_num integer;
BEGIN
  SELECT COALESCE(MAX(so_number), 0) + 1 INTO next_num
  FROM sales_orders WHERE organization_id = org_id;
  RETURN next_num;
END;
$$;

CREATE OR REPLACE FUNCTION set_so_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.so_number IS NULL OR NEW.so_number = 0 THEN
    NEW.so_number := next_so_number(NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_so_number_trigger ON sales_orders;
CREATE TRIGGER set_so_number_trigger
  BEFORE INSERT ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION set_so_number();

-- updated_at trigger (reuses set_updated_at from migration 001)
DROP TRIGGER IF EXISTS set_sales_orders_updated_at ON sales_orders;
CREATE TRIGGER set_sales_orders_updated_at
  BEFORE UPDATE ON sales_orders
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ── RLS on sales_orders ────────────────────────────────────────────────
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can view sales_orders" ON sales_orders;
CREATE POLICY "org members can view sales_orders" ON sales_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sales_orders.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "non-viewers can insert sales_orders" ON sales_orders;
CREATE POLICY "non-viewers can insert sales_orders" ON sales_orders FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sales_orders.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role IN ('owner','admin','member')
    )
  );

DROP POLICY IF EXISTS "non-viewers can update sales_orders" ON sales_orders;
CREATE POLICY "non-viewers can update sales_orders" ON sales_orders FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sales_orders.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role IN ('owner','admin','member')
    )
  );

DROP POLICY IF EXISTS "owners and admins can delete sales_orders" ON sales_orders;
CREATE POLICY "owners and admins can delete sales_orders" ON sales_orders FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = sales_orders.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role IN ('owner','admin')
    )
  );

CREATE INDEX IF NOT EXISTS idx_sales_orders_org      ON sales_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_quote    ON sales_orders(quote_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(customer_id);

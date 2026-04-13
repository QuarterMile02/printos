-- Ensure sales_orders table and related columns exist.
-- Migration 018b may or may not have been applied, so use IF NOT EXISTS
-- throughout so this is safe to run regardless.

-- 1. sales_orders table
CREATE TABLE IF NOT EXISTS sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  so_number integer NOT NULL,
  quote_id uuid REFERENCES quotes(id),
  customer_id uuid REFERENCES customers(id),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_process','completed','hold','no_charge','no_charge_approved','void')),
  title text,
  notes text,
  total integer DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, so_number)
);

-- 2. Auto-increment so_number per organization
CREATE OR REPLACE FUNCTION next_so_number() RETURNS trigger AS $$
BEGIN
  SELECT COALESCE(MAX(so_number), 0) + 1
    INTO NEW.so_number
    FROM sales_orders
   WHERE organization_id = NEW.organization_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_so_number'
  ) THEN
    CREATE TRIGGER set_so_number
      BEFORE INSERT ON sales_orders
      FOR EACH ROW
      WHEN (NEW.so_number IS NULL OR NEW.so_number = 0)
      EXECUTE FUNCTION next_so_number();
  END IF;
END $$;

-- 3. Link quotes → sales_orders
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_to_so_id uuid REFERENCES sales_orders(id);

-- 4. Phase 8 quote columns (may already exist)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS terms text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS subtotal integer DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_total integer DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS total integer DEFAULT 0;

-- 5. RLS
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'so_select_members' AND tablename = 'sales_orders') THEN
    CREATE POLICY so_select_members ON sales_orders FOR SELECT USING (
      organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'so_insert_non_viewers' AND tablename = 'sales_orders') THEN
    CREATE POLICY so_insert_non_viewers ON sales_orders FOR INSERT WITH CHECK (
      organization_id IN (
        SELECT organization_id FROM organization_members
         WHERE user_id = auth.uid() AND role <> 'viewer'
      )
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'so_update_non_viewers' AND tablename = 'sales_orders') THEN
    CREATE POLICY so_update_non_viewers ON sales_orders FOR UPDATE USING (
      organization_id IN (
        SELECT organization_id FROM organization_members
         WHERE user_id = auth.uid() AND role <> 'viewer'
      )
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'so_delete_admins' AND tablename = 'sales_orders') THEN
    CREATE POLICY so_delete_admins ON sales_orders FOR DELETE USING (
      organization_id IN (
        SELECT organization_id FROM organization_members
         WHERE user_id = auth.uid() AND role IN ('owner','admin')
      )
    );
  END IF;
END $$;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_sales_orders_org ON sales_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_quote ON sales_orders(quote_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(customer_id);

-- Phase 11: Invoices table

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  sales_order_id uuid,
  customer_id uuid REFERENCES customers(id),
  invoice_number integer NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','paid','partial','overdue','void')),
  subtotal integer DEFAULT 0,
  tax_total integer DEFAULT 0,
  total integer DEFAULT 0,
  amount_paid integer DEFAULT 0,
  balance_due integer DEFAULT 0,
  due_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, invoice_number)
);

-- Auto-increment invoice_number per org
CREATE OR REPLACE FUNCTION next_invoice_number() RETURNS trigger AS $$
BEGIN
  SELECT COALESCE(MAX(invoice_number), 0) + 1
    INTO NEW.invoice_number
    FROM invoices
   WHERE organization_id = NEW.organization_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_invoice_number') THEN
    CREATE TRIGGER set_invoice_number
      BEFORE INSERT ON invoices
      FOR EACH ROW
      WHEN (NEW.invoice_number IS NULL OR NEW.invoice_number = 0)
      EXECUTE FUNCTION next_invoice_number();
  END IF;
END $$;

-- RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY inv_select_members ON invoices FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY inv_insert_non_viewers ON invoices FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role <> 'viewer')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY inv_update_non_viewers ON invoices FOR UPDATE USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role <> 'viewer')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_so ON invoices(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);

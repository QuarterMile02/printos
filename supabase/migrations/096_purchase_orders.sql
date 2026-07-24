CREATE TABLE IF NOT EXISTS purchase_orders (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  po_number              INTEGER NOT NULL DEFAULT 0,
  vendor_id              UUID REFERENCES vendors(id) ON DELETE SET NULL,
  sales_order_id         UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  status                 TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','sent','partial','received','cancelled')),
  title                  TEXT,
  notes                  TEXT,
  subtotal               NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_total              NUMERIC(12,2) NOT NULL DEFAULT 0,
  total                  NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_delivery_date DATE,
  received_date          DATE,
  created_by             UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, po_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id        UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description  TEXT,
  quantity     NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_cost    NUMERIC(12,4) NOT NULL DEFAULT 0,
  total_cost   NUMERIC(12,2) NOT NULL DEFAULT 0,
  received_qty NUMERIC(10,3) NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_po_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.po_number IS NULL OR NEW.po_number = 0 THEN
    SELECT COALESCE(MAX(po_number), 0) + 1 INTO NEW.po_number
    FROM purchase_orders WHERE org_id = NEW.org_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_po_number ON purchase_orders;
CREATE TRIGGER trg_set_po_number
  BEFORE INSERT ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_po_number();

DROP TRIGGER IF EXISTS set_updated_at_purchase_orders ON purchase_orders;
CREATE TRIGGER set_updated_at_purchase_orders
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can manage purchase_orders" ON purchase_orders;
CREATE POLICY "org members can manage purchase_orders" ON purchase_orders
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.organization_id = purchase_orders.org_id
    )
  );

DROP POLICY IF EXISTS "org members can manage purchase_order_items" ON purchase_order_items;
CREATE POLICY "org members can manage purchase_order_items" ON purchase_order_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      JOIN profiles p ON p.organization_id = po.org_id
      WHERE po.id = purchase_order_items.po_id AND p.id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_purchase_orders_org_id ON purchase_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_id ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_sales_order_id ON purchase_orders(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id ON purchase_order_items(po_id);

GRANT ALL ON purchase_orders TO authenticated;
GRANT ALL ON purchase_order_items TO authenticated;

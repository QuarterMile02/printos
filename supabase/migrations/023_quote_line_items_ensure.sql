-- Ensure quote_line_items table exists with all needed columns.
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS quote_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid REFERENCES quotes(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id),
  product_id uuid,
  product_name text,
  width numeric,
  height numeric,
  quantity integer DEFAULT 1,
  unit_price numeric DEFAULT 0,
  total_price numeric DEFAULT 0,
  description text,
  sort_order integer DEFAULT 0,
  discount_percent numeric DEFAULT 0,
  taxable boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Members can view quote line items"
    ON quote_line_items FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM quotes
        JOIN organization_members ON organization_members.organization_id = quotes.organization_id
        WHERE quotes.id = quote_line_items.quote_id
          AND organization_members.user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Non-viewers can insert quote line items"
    ON quote_line_items FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM quotes
        JOIN organization_members ON organization_members.organization_id = quotes.organization_id
        WHERE quotes.id = quote_line_items.quote_id
          AND organization_members.user_id = auth.uid()
          AND organization_members.role <> 'viewer'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Non-viewers can update quote line items"
    ON quote_line_items FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM quotes
        JOIN organization_members ON organization_members.organization_id = quotes.organization_id
        WHERE quotes.id = quote_line_items.quote_id
          AND organization_members.user_id = auth.uid()
          AND organization_members.role <> 'viewer'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Non-viewers can delete quote line items"
    ON quote_line_items FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM quotes
        JOIN organization_members ON organization_members.organization_id = quotes.organization_id
        WHERE quotes.id = quote_line_items.quote_id
          AND organization_members.user_id = auth.uid()
          AND organization_members.role <> 'viewer'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add columns that may be missing from older schema
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id);
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS product_id uuid;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS width numeric;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS height numeric;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS total_price numeric DEFAULT 0;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS taxable boolean DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote ON quote_line_items(quote_id);

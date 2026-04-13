-- Ensure quote_line_items has RLS enabled and policies exist.
-- Uses EXCEPTION pattern since Postgres doesn't support IF NOT EXISTS on CREATE POLICY.

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
  CREATE POLICY "Admins and owners can delete quote line items"
    ON quote_line_items FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM quotes
        JOIN organization_members ON organization_members.organization_id = quotes.organization_id
        WHERE quotes.id = quote_line_items.quote_id
          AND organization_members.user_id = auth.uid()
          AND organization_members.role IN ('owner', 'admin')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Ensure Phase 8 columns exist on quote_line_items
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id);
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS width numeric;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS height numeric;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS total_price integer DEFAULT 0;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS taxable boolean DEFAULT true;

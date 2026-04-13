-- Add columns that the addQuoteLineItem action inserts but may not exist yet.
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS product_id uuid;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS width numeric;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS height numeric;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS total_price integer DEFAULT 0;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS taxable boolean DEFAULT true;

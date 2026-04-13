-- Add ShopVOX-inspired fields to quotes table.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS due_date timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sales_rep_id uuid REFERENCES auth.users(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS po_number text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS install_address text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS production_notes text;

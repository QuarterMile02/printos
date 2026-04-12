-- Add Phase 8 columns to quotes table if they don't exist yet.
-- These were defined in 018b_quotes_phase_8.sql but may not have been applied.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS terms text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS subtotal integer DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_total integer DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS total integer DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_to_so_id uuid REFERENCES sales_orders(id);

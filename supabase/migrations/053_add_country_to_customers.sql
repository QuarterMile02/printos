ALTER TABLE customers ADD COLUMN IF NOT EXISTS country text DEFAULT 'US';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS secondary_country text;

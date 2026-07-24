ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS is_posted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;

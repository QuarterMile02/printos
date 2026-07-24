ALTER TABLE general_categories
  ADD COLUMN IF NOT EXISTS sub_type text;

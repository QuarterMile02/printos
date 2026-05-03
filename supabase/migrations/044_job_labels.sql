-- Migration 044: job label printing
-- Tracks when a physical label was last printed for a job.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS label_printed_at timestamptz;

-- Migration 018a: Add new values to quote_status enum.
--
-- ⚠️ MUST be run BEFORE 018b. Postgres requires ADD VALUE to be committed
-- before any UPDATE can reference the new value, otherwise:
--   ERROR: unsafe use of new value of enum type "quote_status"
--
-- Paste this whole file into Supabase SQL editor, click Run, wait for
-- success, THEN paste 018b and run.

ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'customer_review';
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'approve_with_changes';
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'revise';
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'ordered';
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'hold';
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'lost';
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'no_charge';

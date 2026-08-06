-- ============================================================
-- Migration 114: Add 'on_hold' and 'pending_approval' to job_status enum
-- Applied: (pending — run manually in Supabase SQL Editor)
-- ============================================================
--
-- Context: Department Queue dashboard widget (DepartmentQueueWidget.tsx)
-- and the Department Board display (DepartmentBoard.tsx) both already
-- reference job status values 'on_hold' and 'pending_approval', but these
-- were never added to the job_status enum (only 'new', 'in_progress',
-- 'proof_review', 'ready_for_pickup', 'completed' exist — see 003_jobs.sql).
-- Any query filtering on the missing values throws
-- "invalid input value for enum job_status", which is what's crashing the
-- Department Queue widget's server-side render right now.
--
-- ⚠️ Same rule as 018a_quotes_status_enum.sql: ADD VALUE must be committed
-- before any statement in the same transaction can reference the new
-- value ("unsafe use of new value of enum type"). Paste this whole file
-- into the Supabase SQL editor and Run it on its own — don't combine it
-- with other statements that use 'on_hold' or 'pending_approval' in the
-- same execution.

ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'pending_approval';

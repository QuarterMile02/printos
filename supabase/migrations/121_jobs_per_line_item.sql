-- ============================================================
-- Migration 121: Jobs move to one-per-line-item grain
-- Applied: (pending — run manually in Supabase SQL Editor)
-- ============================================================
--
-- Backs the job-creation grain change: jobs.insert (currently one job per
-- Sales Order, in quotes/[id]/convert-action.ts) becomes one job per quote
-- line item. Confirmed against this project's own planning docs
-- (Docs/PrintOS_Project_Status_v17.py, Docs/PrintOS_Blueprint_Internal_Spec_v25.py
-- -- "ShopVOX Jobs-Family Research" tables) that this is the already-
-- recorded target grain ("1 job (= 1 line item off a Sales Order)"), not a
-- new decision -- the current one-job-per-SO code is the divergence.
--
-- quote_line_item_id — which line item this job is for. Nullable +
-- ON DELETE SET NULL: a line item can be deleted from a quote after the
-- job exists (e.g. quote edited post-approval in some edge case) without
-- cascading away production history on the job itself. Every NEW job
-- created via convertToSalesOrder will have this set; existing jobs (all
-- created before this migration, one per SO) will have it null -- not
-- backfilled here. A null value on an old job is a real, meaningful
-- "this job predates the per-line-item grain" signal, not an error state,
-- and every read site (workflow steps query, job board's per-job product
-- lookup, proof upload's line-item tag dropdown) needs to keep degrading
-- gracefully for null the same way they already degrade for other
-- optional/nullable job fields elsewhere in this codebase.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS quote_line_item_id uuid REFERENCES quote_line_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_quote_line_item ON jobs(quote_line_item_id) WHERE quote_line_item_id IS NOT NULL;

-- Grants — explicit per project policy, even though this is column-only.
-- jobs already has explicit whole-table grants
-- (supabase/migrations/057_backfill_grants.sql:43-44,
-- `grant select, insert, update, delete on public.jobs to
-- authenticated/service_role;` -- no anon grant). Re-issued below for
-- audit-trail consistency only, same as every other column-only migration
-- this session (118, 119, 120).
grant select, insert, update, delete on public.jobs to authenticated;
grant select, insert, update, delete on public.jobs to service_role;

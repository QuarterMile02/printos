-- ============================================================
-- Migration 120: Per-invoice IIF export tracking (repeat-send safeguard)
-- Applied: (pending — run manually in Supabase SQL Editor)
-- ============================================================
--
-- Closes a real gap in the scheduled invoice IIF export
-- (src/app/api/cron/invoice-iif-export/route.ts, migration 118): posting
-- stays a manual, deliberate step, so an invoice that isn't promptly marked
-- posted after import will still be `is_posted = false` the next day and
-- gets swept into and re-emailed by the very next scheduled run, with
-- nothing today distinguishing "first time this has gone out" from "this
-- already went out yesterday, are you sure you want to import it again."
--
-- Research finding backing why this needs an explicit safeguard rather
-- than relying on QuickBooks itself: QuickBooks Desktop's standard IIF
-- import (File > Utilities > Import > IIF Files) has NO built-in duplicate
-- detection. Re-importing the same DOCNUM/invoice a second time creates a
-- second, duplicate transaction -- QuickBooks does not check. The TRNSID
-- field some sources cite as a dedup key does not provide this either: for
-- IIF files it is populated *by QuickBooks* the first time a transaction is
-- imported and is conventionally left blank on the outbound file (ours
-- already does this, see build-invoices-iif.ts's `['TRNS', '', ...]`) --
-- it's an internal ID QuickBooks assigns, not a de-dup key it consults on
-- the way in. (Source: https://help.propersoft.net/article/104-avoid-importing-duplicated-transactions-quickbooks
-- -- "If you are importing IIF files, there is no way to avoid duplicates
-- for existing transactions and transactions that are being imported."
-- The cross-import "Unique Transaction ID" dedup some QuickBooks docs
-- mention belongs to the separate QBO file format, not IIF.) So this has
-- to be enforced on our side, before the file is even generated.
--
-- Design: track export history per invoice (not just per-org, since
-- accounting_settings.iif_export_last_sent_at from migration 118 only says
-- an org's job ran on some date -- it can't say WHICH invoices went out,
-- which is what's needed to flag a specific repeat). Both existing export
-- paths funnel through the same src/lib/iif/build-invoices-iif.ts, so
-- either one marking these columns keeps "has this invoice ever left the
-- building via IIF" accurate regardless of which route sent it (manual
-- bulk export from the Accounting page, or the scheduled cron job).
--
-- Columns:
--   iif_first_exported_at — set once, the first time this invoice appears
--                            in a successfully generated/sent IIF export.
--                            Null = never exported.
--   iif_last_exported_at  — updated every time, the most recent export.
--   iif_export_count      — incremented every time. A value > 0 at the
--                            START of building a new export is exactly the
--                            "this is a repeat" signal the caller checks
--                            before generating the file, so it can annotate
--                            the email and the IIF MEMO field accordingly.
--
-- Not building a separate export-log table for this: the ask is a
-- lightweight flag, not a full audit trail, and three columns are enough
-- to answer "have I sent this before" and "when" without a join. If a full
-- per-export history is ever needed later (e.g. "show me every time this
-- invoice was exported and to whom"), that's a bigger, separate feature.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS iif_first_exported_at timestamptz,
  ADD COLUMN IF NOT EXISTS iif_last_exported_at timestamptz,
  ADD COLUMN IF NOT EXISTS iif_export_count integer NOT NULL DEFAULT 0;

-- Grants — explicit per project policy, even though this is column-only
-- (no new table). invoices already has explicit whole-table grants
-- (supabase/migrations/057_backfill_grants.sql:73-74,
-- `grant select, insert, update, delete on public.invoices to
-- authenticated/service_role;` -- no anon grant, consistent with the rest
-- of this table). A table-level GRANT with no column list covers columns
-- added later via ALTER TABLE ADD COLUMN automatically; re-issuing below
-- is a no-op, included for audit-trail consistency with this session's
-- other migrations (see migration 118's identical note).
grant select, insert, update, delete on public.invoices to authenticated;
grant select, insert, update, delete on public.invoices to service_role;

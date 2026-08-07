-- ============================================================
-- Migration 118: Scheduled invoice IIF export settings
-- Applied: (pending — run manually in Supabase SQL Editor)
-- ============================================================
--
-- Backs the new automated "email today's unposted invoices as an IIF
-- export" cron job (src/app/api/cron/invoice-iif-export/route.ts), which
-- replaces the need for someone to log into PrintOS and manually download
-- the bulk IIF export.
--
-- Added to accounting_settings (NOT a new qb_settings column) because this
-- page (Settings > Accounting) already fetches and manages that table with
-- a full CRUD action (upsertAccountingSettings) and settings UI — reusing
-- it needs zero new fetch/query plumbing, just three new columns and one
-- new SectionCard. qb_settings has no settings UI at all today and stores
-- QuickBooks chart-of-accounts values, a different concern than "who
-- should get the scheduled email."
--
-- Columns:
--   iif_export_enabled         — per-org on/off switch for the scheduled job.
--   iif_export_recipient_email — where to send it (e.g.
--                                 accounting@quartermileinc.com). Nullable;
--                                 the cron job skips any org where this is
--                                 null or enabled is false.
--   iif_export_last_sent_at    — set by the cron job after each successful
--                                 send, surfaced in the settings UI ("Last
--                                 sent: ...") for visibility. Not used for
--                                 any dedup/locking logic — Vercel Cron
--                                 itself doesn't double-fire, so this is
--                                 purely informational.
--
-- NOTE on schedule: there is intentionally no "time of day" column here.
-- Confirmed with Ruben: Vercel plan is Hobby tier, whose Cron minimum
-- interval is once per day at a fixed time (no per-org precision) — see
-- vercel.json for the actual fixed UTC time. A true per-org configurable
-- send time needs Vercel Pro+ (hourly+ triggers) and would need a follow-up
-- migration adding an hour/minute column plus reworking the cron route to
-- run hourly and check each org's configured hour, at that point.
--
-- NOTE: accounting_settings' canonical migration file
-- (src/supabase/migrations/081_accounting_settings.sql) lives OUTSIDE the
-- canonical supabase/migrations directory this session has consistently
-- used (numbered files 001-117) -- flagging this discrepancy rather than
-- trying to mirror it; this migration follows the supabase/migrations
-- convention used everywhere else.

ALTER TABLE accounting_settings
  ADD COLUMN IF NOT EXISTS iif_export_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS iif_export_recipient_email text,
  ADD COLUMN IF NOT EXISTS iif_export_last_sent_at timestamptz;

-- Grants — explicit per project policy, even though this is column-only
-- (no new table). accounting_settings already has an explicit whole-table
-- grant (src/supabase/migrations/081_accounting_settings.sql:119,
-- `GRANT ALL ON accounting_settings TO authenticated, service_role;` — no
-- anon grant). A table-level GRANT with no column list covers columns
-- added later via ALTER TABLE ADD COLUMN automatically; re-issuing below
-- is a no-op, included for audit-trail consistency with this session's
-- other migrations.
grant select, insert, update, delete on public.accounting_settings to authenticated;
grant select, insert, update, delete on public.accounting_settings to service_role;

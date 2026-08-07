-- ============================================================
-- Migration 117: Quote "ready to send" state
-- Applied: (pending — run manually in Supabase SQL Editor)
-- ============================================================
--
-- Backs the new Done/Edit workflow on the quote detail page:
--   - Clicking "Done" (after the AI title-suggestion modal resolves, either
--     way) sets ready_to_send = true, locking the Quote Details section
--     and line items to read-only.
--   - Clicking "Edit" while ready sets ready_to_send = false, unlocking
--     the section again.
--   - Any content edit (quote fields via updateQuoteFields, or line items
--     via recalcQuoteTotals, which every line-item mutation runs through)
--     also clears ready_to_send = false server-side as a defense-in-depth
--     backstop, independent of the Edit button.
--   - Send Email skips the AI title-suggestion popup when ready_to_send is
--     already true (trusts it was handled via Done); quotes that were
--     never marked Done fall back to the existing suggest-at-send-time
--     behavior, gated by ready_to_send defaulting to false.
--
-- NOT NULL DEFAULT false so every existing quote (never been through this
-- new flow) starts unlocked/not-ready, matching current behavior exactly
-- — nothing changes for any quote until someone clicks Done on it.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS ready_to_send boolean NOT NULL DEFAULT false;

-- Grants — explicit per project policy (_TEMPLATE_migration.sql), even
-- though this is column-only (no new table). quotes already has an
-- explicit whole-table grant on record (supabase/migrations/
-- 057_backfill_grants.sql: "quotes: no anon (financial/PII)" — select,
-- insert, update, delete to authenticated and service_role, no anon
-- grant). A table-level GRANT with no column list covers columns added
-- later via ALTER TABLE ADD COLUMN automatically — re-issuing the same
-- statements below is a no-op, included for audit-trail consistency.
grant select, insert, update, delete on public.quotes to authenticated;
grant select, insert, update, delete on public.quotes to service_role;

-- ============================================================
-- Migration 192: purchase_orders.status — add 'Void'
-- (renumbered from 125 — collided with an existing 125_form_field_settings_seed.sql
-- pulled in from another machine; content unchanged, only the number/name moved)
-- Applied: 2026-08-29
-- ============================================================
--
-- The original purchase_orders_status_check constraint (Migration H,
-- 2026-08-25) carried 5 lowercase PrintOS values plus 8 ShopVOX values
-- verbatim (Draft, Emailed, Open, Ordered, Approved, Closed, Paid,
-- Received). 4 staged purchase orders carry ShopVOX's 'Void' status,
-- which that constraint rejected outright.
--
-- Dropped and re-added (Postgres has no ALTER CONSTRAINT for a CHECK's
-- expression) to add 'Void' to the allowed set.
--
-- NOTE — this constraint deliberately carries TWO vocabularies at once:
-- PrintOS's own lowercase set (draft, sent, partial, received, cancelled)
-- and ShopVOX's title-case set, kept verbatim per the project's standing
-- status-vocabulary rule (no translation/mapping at import time — see
-- scripts/SHOPVOX_MIGRATION_NOTES.md, "KEEP SHOPVOX'S STATUS NAMES
-- EXACTLY"). All 1,179 historical (ShopVOX-sourced) purchase_orders use
-- the ShopVOX set exclusively — confirmed live, 0 rows use a lowercase
-- value. Whether/how the two vocabularies get reconciled in the UI (a
-- single status filter/badge component has to make sense of both) is an
-- open question, not resolved by this migration.

alter table purchase_orders drop constraint purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check
  check (status = any (array[
    'draft','sent','partial','received','cancelled',
    'Draft','Emailed','Open','Ordered','Approved','Closed','Paid','Received','Void'
  ]::text[]));

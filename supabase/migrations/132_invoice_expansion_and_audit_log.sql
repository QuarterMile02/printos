-- ============================================================
-- Migration 132: Invoice feature expansion + audit-log field-level diffs
-- Applied: CONFIRMED LIVE in Supabase (2026-08-15) — "Success. No rows returned."
-- ============================================================
--
-- Full spec locked in 2026-08-14. Implements the schema side of:
--   1. Unpost/Edit/Repost flow on invoices (is_posted/posted_at already
--      exist from migration 090 — this migration adds the columns that
--      become editable once unposted, plus a defense-in-depth guard).
--   2. contact_id + billing/shipping address as invoice-native, editable,
--      independently-snapshotted fields (not a live join to customers).
--   3. install_address — invoice-native, matches quotes.install_address's
--      flat-text pattern (migration 021), NOT shared/synced with the
--      customer's saved addresses.
--   4. activity_log field-level diff support (field_name, change_group_id)
--      and a cross-entity order_thread_id for the centralized audit view.
--
-- Workflow templates: explicitly out of scope (Ruben's call — PrintOS's
-- product recipe is the workflow-template equivalent, not a real gap).
-- SITE: dropped, not built.
--
-- Both open judgment calls from the proposal pass are now CONFIRMED —
-- migration approved as-drafted, no further changes pending:
--   1. Posted-edit guard trigger (section 2 below) — keep it, not commented
--      out.
--   2. Shipping backfill (section 1 below) — customers.secondary_* only.
--      Investigated whether quotes/sales_orders persist a reference to a
--      specific shipping_addresses row (migration 076) to prefer over the
--      customer's generic default: confirmed neither table has any such
--      column. The "Saved shipping address" dropdown on the quote detail
--      page only feeds an EasyPost rate-quote request in local component
--      state (quote-detail-client.tsx's smSavedAddrId) — never written
--      back to quotes or sales_orders. shipments.ship_to_* (migration 108)
--      is the closest real per-order snapshot that exists, but it's
--      per-shipment, not per-order, and — checked live — 0 of the 2
--      invoices that exist today have an SO with a populated shipment
--      snapshot to prefer anyway. Backfill stays customers.secondary_*
--      only, no shipment-preference logic.

-- ── 1. invoices — contact, billing/shipping address, install address ─────
--
-- Deliberately flat/denormalized text columns on invoices itself, NOT a
-- live join to customers and NOT an FK to shipping_addresses — same
-- pattern already proven for shipments.ship_to_* (migration 108): an
-- editable per-record snapshot that can diverge from the customer's
-- saved data once set, which is exactly what "editable billing/shipping
-- address, cascades only on explicit customer/company-name change" needs.
--
-- contact_id mirrors the exact FK shape already used on quotes/
-- sales_orders/jobs (migration 058) — invoices is the one entity in that
-- family that never got it.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES customer_contacts(id) ON DELETE SET NULL,

  -- Billing address block. billing_company_name is intentionally the
  -- ONLY "name" field here — per the confirmed spec, company name is not
  -- a free-editable override; it always tracks the selected customer and
  -- changes only via the customer_id cascade (see actions.ts note below).
  ADD COLUMN IF NOT EXISTS billing_company_name text,
  ADD COLUMN IF NOT EXISTS billing_street       text,
  ADD COLUMN IF NOT EXISTS billing_street2      text,
  ADD COLUMN IF NOT EXISTS billing_city         text,
  ADD COLUMN IF NOT EXISTS billing_state        text,
  ADD COLUMN IF NOT EXISTS billing_zip          text,

  -- Shipping address block — same shape, independently editable.
  ADD COLUMN IF NOT EXISTS shipping_name    text,
  ADD COLUMN IF NOT EXISTS shipping_street  text,
  ADD COLUMN IF NOT EXISTS shipping_street2 text,
  ADD COLUMN IF NOT EXISTS shipping_city    text,
  ADD COLUMN IF NOT EXISTS shipping_state   text,
  ADD COLUMN IF NOT EXISTS shipping_zip     text,

  -- Install address — invoice-native, independent of both billing and
  -- shipping above and of the customer's saved addresses. Flat text,
  -- exactly matching quotes.install_address's type (migration 021).
  ADD COLUMN IF NOT EXISTS install_address text;

CREATE INDEX IF NOT EXISTS idx_invoices_contact ON invoices(contact_id);

-- One-time backfill for the 14+ existing invoices, so this doesn't ship
-- as silently-blank columns on every pre-existing row. Idempotent (only
-- touches rows where the target is still NULL).

-- contact_id: inherit from the linked Sales Order's contact, same as a
-- freshly-created invoice would per the confirmed spec.
UPDATE invoices i
SET contact_id = so.contact_id
FROM sales_orders so
WHERE i.sales_order_id = so.id
  AND i.contact_id IS NULL
  AND so.contact_id IS NOT NULL;

-- Billing address: snapshot from the linked customer's primary address.
UPDATE invoices i
SET billing_company_name = c.company_name,
    billing_street        = c.street,
    billing_street2        = c.street2,
    billing_city           = c.city,
    billing_state          = c.state,
    billing_zip            = c.zip
FROM customers c
WHERE i.customer_id = c.id
  AND i.billing_street IS NULL;

-- Shipping address: default to the customer's secondary (Ship To)
-- address if one exists; otherwise leave null (falls back to billing in
-- the UI, not defaulted here). NOTE: if a customer has multiple saved
-- shipping_addresses rows (migration 076), this only backfills from the
-- single secondary_* columns on customers, not the shipping_addresses
-- table — flagging this as a backfill judgment call to confirm.
UPDATE invoices i
SET shipping_name   = c.company_name,
    shipping_street = c.secondary_street,
    shipping_city   = c.secondary_city,
    shipping_state  = c.secondary_state,
    shipping_zip    = c.secondary_zip
FROM customers c
WHERE i.customer_id = c.id
  AND i.shipping_street IS NULL
  AND c.secondary_street IS NOT NULL;

-- ── 2. Optional hardening: block edits to a posted invoice at the DB ──────
-- layer, not just the UI layer.
--
-- Why this is worth it: recordPayment/postInvoices/createInvoiceFromSO
-- all write via the service-role client, which bypasses RLS entirely —
-- RLS alone can't be the enforcement point for "these fields are only
-- editable while unposted." A trigger is the one place that check holds
-- regardless of which code path (or future code path) does the UPDATE.
-- FLAGGING AS RECOMMENDED, NOT ASSUMED — comment out if you'd rather
-- enforce this purely in the server action layer for now.

CREATE OR REPLACE FUNCTION guard_invoice_edit_when_posted() RETURNS trigger AS $$
BEGIN
  IF OLD.is_posted = true AND NEW.is_posted = true THEN
    IF NEW.customer_id           IS DISTINCT FROM OLD.customer_id
    OR NEW.contact_id            IS DISTINCT FROM OLD.contact_id
    OR NEW.billing_company_name  IS DISTINCT FROM OLD.billing_company_name
    OR NEW.billing_street        IS DISTINCT FROM OLD.billing_street
    OR NEW.billing_street2       IS DISTINCT FROM OLD.billing_street2
    OR NEW.billing_city          IS DISTINCT FROM OLD.billing_city
    OR NEW.billing_state         IS DISTINCT FROM OLD.billing_state
    OR NEW.billing_zip           IS DISTINCT FROM OLD.billing_zip
    OR NEW.shipping_name         IS DISTINCT FROM OLD.shipping_name
    OR NEW.shipping_street       IS DISTINCT FROM OLD.shipping_street
    OR NEW.shipping_street2      IS DISTINCT FROM OLD.shipping_street2
    OR NEW.shipping_city         IS DISTINCT FROM OLD.shipping_city
    OR NEW.shipping_state        IS DISTINCT FROM OLD.shipping_state
    OR NEW.shipping_zip          IS DISTINCT FROM OLD.shipping_zip
    OR NEW.title                 IS DISTINCT FROM OLD.title
    OR NEW.notes                 IS DISTINCT FROM OLD.notes
    OR NEW.install_address       IS DISTINCT FROM OLD.install_address
    THEN
      RAISE EXCEPTION 'Cannot edit invoice % while posted — unpost first', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoice_edit_guard ON invoices;
CREATE TRIGGER invoice_edit_guard
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_edit_when_posted();

-- ── 3. activity_log — field-level diff support ────────────────────────────
--
-- Existing shape (migration 128) already supports one from_value/to_value
-- pair per row, which is enough for a single field change — the gap is
-- (a) no column says WHICH field changed (buried in metadata jsonb today,
-- not filterable/indexable), and (b) no way to group N field-diff rows
-- from one edit-and-save into a single logical "edit event" for display.
--
-- field_name: nullable — set only on field-level diff rows (action =
--   'field_changed'); left null on pure status-transition rows so every
--   existing call site and every existing row keeps working unchanged.
-- change_group_id: nullable — the calling code generates ONE uuid per
--   save action and reuses it across every field-diff row that save
--   produced, so "Ruben changed 3 fields at 2:14pm" renders as one
--   grouped entry, not three disconnected lines.

ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS field_name       text,
  ADD COLUMN IF NOT EXISTS change_group_id  uuid;

CREATE INDEX IF NOT EXISTS idx_activity_log_change_group
  ON activity_log(change_group_id) WHERE change_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_log_entity_created
  ON activity_log(entity_type, entity_id, created_at DESC);

-- ── 4. activity_log — order_thread_id (centralized cross-entity view) ────
--
-- The FK chain that ties one real-world order together across stages is:
--   jobs.source_quote_id -> quotes.id
--   quotes.converted_to_so_id -> sales_orders.id
--   invoices.sales_order_id -> sales_orders.id
-- There's no single shared id today that a "show me this whole order's
-- history top to bottom" query could filter on without a multi-table
-- join fanning out per row. order_thread_id denormalizes one stable
-- anchor (the originating quote_id, or the sales_order_id itself for
-- orders with no quote) onto every activity_log row for that order's
-- full lifecycle, at write time — every logActivity() call site for
-- quote/SO/job/invoice/proof/collection-call events passes it. Centralized
-- view becomes one flat `WHERE order_thread_id = $1 ORDER BY created_at`;
-- the embedded per-page views are unaffected (still filter on the
-- existing entity_type + entity_id).

ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS order_thread_id uuid;

CREATE INDEX IF NOT EXISTS idx_activity_log_order_thread
  ON activity_log(order_thread_id, created_at) WHERE order_thread_id IS NOT NULL;

-- ── 5. RLS + grants ────────────────────────────────────────────────────
--
-- No new policies needed. invoices' existing inv_select_members /
-- inv_insert_non_viewers / inv_update_non_viewers (migration 026) are
-- column-less USING/WITH CHECK clauses — they already cover every column
-- added here, including Unpost/Repost (both are plain UPDATEs against
-- the same table). activity_log's existing "org members can view
-- activity" (SELECT) and "system can insert activity" (INSERT WITH
-- CHECK true) likewise already cover field_name/change_group_id/
-- order_thread_id. FLAGGING, not deciding: Unpost is an accounting-
-- reopening action — if you want it restricted tighter than "any
-- non-viewer member" (e.g. owner/admin only, matching jobs' delete
-- policy pattern), that would need a new, narrower policy or an
-- app-layer role check in the Unpost server action. Not added here
-- since posting itself currently has no such restriction either.
--
-- Grants re-issued per this session's standing convention (explicit
-- grants required on every migration touching these tables since
-- Supabase stopped auto-granting, May 2026 — migrations 120/128's note).

grant select, insert, update, delete on public.invoices     to authenticated;
grant select, insert, update, delete on public.invoices     to service_role;
grant select, insert, update, delete on public.activity_log to authenticated;
grant select, insert, update, delete on public.activity_log to service_role;

NOTIFY pgrst, 'reload schema';

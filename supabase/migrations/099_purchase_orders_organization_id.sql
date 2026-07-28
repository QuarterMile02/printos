-- ============================================================
-- Migration 099: Rename purchase_orders.org_id to organization_id
-- ============================================================
--
-- Every other org-scoped table in this schema (customers, quotes,
-- sales_orders, invoices, vendors, ...) uses organization_id.
-- purchase_orders alone used org_id, and the shared fetchDataTablePage
-- helper (src/lib/data-table/fetch.ts) hardcodes
-- .eq('organization_id', orgId) for every table it queries — there is
-- no per-table override, and that file must not be modified. This
-- rename is required before the shared data-table system can query
-- purchase_orders at all.
--
-- Postgres automatically updates RLS policies, indexes, and
-- constraints to track a renamed column (they're stored as parsed
-- catalog entries, not literal text). The trigger function
-- set_po_number() is NOT automatically updated — a PL/pgSQL function
-- body is stored as opaque text (pg_proc.prosrc), and a column rename
-- does not rewrite references inside it. Left alone, the very next
-- INSERT into purchase_orders would fail with
-- "column org_id does not exist". Re-created explicitly below with
-- organization_id substituted.

ALTER TABLE purchase_orders RENAME COLUMN org_id TO organization_id;

CREATE OR REPLACE FUNCTION set_po_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.po_number IS NULL OR NEW.po_number = 0 THEN
    SELECT COALESCE(MAX(po_number), 0) + 1 INTO NEW.po_number
    FROM purchase_orders WHERE organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Cosmetic only — keeps the index name consistent with the column it
-- indexes. Not functionally required (the index itself already
-- follows the rename automatically).
ALTER INDEX idx_purchase_orders_org_id RENAME TO idx_purchase_orders_organization_id;

-- Migration 042: vendors table + shopvox import timestamp on customers
-- Applied manually via Supabase SQL editor on 2026-05-02.
-- Idempotent — safe to re-run.

-- ── 1. customers — import tracking ──────────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS shopvox_imported_at timestamptz;

-- ── 2. vendors — new table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  legal_name      text,
  primary_contact text,
  primary_email   text,
  primary_phone   text,
  street          text,
  city            text,
  state           text,
  zip             text,
  country         text,
  secondary_street text,
  secondary_city   text,
  secondary_state  text,
  secondary_zip    text,
  website         text,
  catalog_url     text,
  account_id      text,
  tax_id          text,
  tax             text,
  terms           text,
  payment_method  text,
  categories      text,
  hours_of_operation text,
  background_info text,
  is_active       boolean DEFAULT true,
  shopvox_imported_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

DROP TRIGGER IF EXISTS set_vendors_updated_at ON vendors;
CREATE TRIGGER set_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view vendors"   ON vendors;
DROP POLICY IF EXISTS "Org members can insert vendors" ON vendors;
DROP POLICY IF EXISTS "Org members can update vendors" ON vendors;
DROP POLICY IF EXISTS "Owners and admins can delete vendors" ON vendors;

CREATE POLICY "Org members can view vendors"
  ON vendors FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_members om
                 WHERE om.organization_id = vendors.organization_id
                   AND om.user_id = auth.uid()));

CREATE POLICY "Org members can insert vendors"
  ON vendors FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM organization_members om
                      WHERE om.organization_id = vendors.organization_id
                        AND om.user_id = auth.uid()
                        AND om.role IN ('owner','admin','member')));

CREATE POLICY "Org members can update vendors"
  ON vendors FOR UPDATE
  USING (EXISTS (SELECT 1 FROM organization_members om
                 WHERE om.organization_id = vendors.organization_id
                   AND om.user_id = auth.uid()
                   AND om.role IN ('owner','admin','member')));

CREATE POLICY "Owners and admins can delete vendors"
  ON vendors FOR DELETE
  USING (EXISTS (SELECT 1 FROM organization_members om
                 WHERE om.organization_id = vendors.organization_id
                   AND om.user_id = auth.uid()
                   AND om.role IN ('owner','admin')));

CREATE INDEX IF NOT EXISTS idx_vendors_org  ON vendors(organization_id);
CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors(organization_id, lower(name));

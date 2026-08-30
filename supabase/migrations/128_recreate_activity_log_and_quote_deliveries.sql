-- ============================================================
-- Migration 128: Recreate activity_log and quote_deliveries
-- Applied: NOT YET APPLIED — proposed only, paste into Supabase SQL editor to run
-- ============================================================
--
-- Fixes the finding in schema-drift-findings.md Section 9: both tables
-- are defined in checked-in migrations (011_users_permissions.sql and
-- 006_quote_deliveries.sql respectively), have real application code
-- actively writing to them, and yet neither exists in the live
-- database — confirmed for activity_log directly in Supabase's Table
-- Editor ("No results found" in the public schema's table list, bypassing
-- PostgREST's schema cache entirely), and inferred for quote_deliveries
-- via the identical failure signature across four independent live query
-- attempts (vs. control queries against older/similar-era tables that
-- succeeded normally). Neither table shows any prior DROP anywhere in
-- supabase/migrations/, so whatever removed them (or prevented them from
-- ever landing) happened outside migration tracking.
--
-- This migration is CREATE TABLE IF NOT EXISTS throughout — safe to run
-- even if one of the two tables turns out to already exist after all
-- (e.g. if quote_deliveries' absence was actually a transient issue that
-- resolves before this runs; unlikely, per the investigation, but this
-- keeps the migration idempotent and re-runnable regardless).
--
-- Every column, index, and RLS policy below is copied verbatim from the
-- original migration files — this is a restoration, not a redesign. The
-- only two things NOT present in the originals are explicitly added
-- here: (1) explicit GRANT statements, since Supabase stopped
-- auto-granting as of May 2026 and every migration since has needed them
-- explicitly (both 011 and 006 predate that change); (2) a defensive
-- CREATE EXTENSION for uuid-ossp ahead of quote_deliveries' use of
-- uuid_generate_v4() (that function requires the extension; the original
-- migration assumed it was already enabled — this makes that assumption
-- explicit and safe to re-run instead of a hard requirement).

-- ── activity_log (originally 011_users_permissions.sql) ──────────────────────

CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  from_value text,
  to_value text,
  qr_scan_location text,
  equipment_name text,
  department_code text,
  duration_seconds int,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_org ON activity_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can view activity" ON activity_log;
CREATE POLICY "org members can view activity" ON activity_log
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "system can insert activity" ON activity_log;
CREATE POLICY "system can insert activity" ON activity_log
  FOR INSERT WITH CHECK (true);

-- Grants (required — Supabase no longer auto-grants as of May 2026; the
-- original 011 migration predates this and never had explicit grants,
-- which may be part of why this table never actually landed usably).
-- No anon grant — same as invoices' precedent (migration 120's note):
-- no legitimate anon/public consumer of this table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_log TO service_role;

-- ── quote_deliveries (originally 006_quote_deliveries.sql) ───────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE delivery_method AS ENUM ('email', 'sms', 'both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS quote_deliveries (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id         uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  method           delivery_method NOT NULL,
  sent_by          uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_email  text,
  recipient_phone  text,
  status           text NOT NULL DEFAULT 'sent',
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quote_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view deliveries" ON quote_deliveries;
CREATE POLICY "Org members can view deliveries"
  ON quote_deliveries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = quote_deliveries.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Org members can insert deliveries" ON quote_deliveries;
CREATE POLICY "Org members can insert deliveries"
  ON quote_deliveries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = quote_deliveries.organization_id
        AND organization_members.user_id = auth.uid()
        AND organization_members.role IN ('owner', 'admin', 'member')
    )
  );

CREATE INDEX IF NOT EXISTS idx_quote_deliveries_quote ON quote_deliveries(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_deliveries_org   ON quote_deliveries(organization_id);

-- Grants (required — same rationale as activity_log above; 006 predates
-- the explicit-grant requirement too). No anon grant — quote_deliveries
-- is only ever written server-side via the service-role client from
-- staff-triggered actions (searchQuotes/sendQuoteEmail/sendQuoteSms),
-- never anything customer- or public-facing.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_deliveries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_deliveries TO service_role;

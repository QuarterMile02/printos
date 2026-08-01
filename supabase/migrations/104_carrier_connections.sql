-- ============================================================
-- Migration 104: carrier_connections
-- Applied: 2026-07-31
-- ============================================================
--
-- Per-org connected shipping carrier accounts (Settings -> Shipping ->
-- Carriers). Replaces the single global EasyPost API key (Vercel env
-- vars EASYPOST_API_KEY / EASYPOST_TEST_API_KEY) with per-org storage,
-- so other orgs/franchisees can connect their own carrier accounts
-- instead of editing server config. The env vars remain as a fallback
-- in src/lib/easypost.ts for orgs that haven't connected yet — see
-- that file for the fallback logic.
--
-- Unlike payment_gateway_settings (one row per org, UNIQUE on
-- organization_id alone), an org can connect MULTIPLE carriers at
-- once (EasyPost + FedEx simultaneously, etc.), so the uniqueness
-- constraint is on (organization_id, carrier), not organization_id.
--
-- Credential shape varies per carrier and lives in `credentials`
-- jsonb:
--   easypost: { api_key, test_api_key }
--   fedex:    { client_id, client_secret, test_client_id, test_client_secret, account_number }
--
-- KNOWN GAP: credentials are stored PLAINTEXT in jsonb, matching the
-- existing payment_gateway_settings pattern (also plaintext). Real
-- encryption at rest for both tables is a tracked follow-up, not done
-- in this pass.
--
-- NOTE ON MIGRATION LOCATION: payment_gateway_settings' migration
-- (083_payment_gateway_settings.sql) was incorrectly placed under
-- src/supabase/migrations/ instead of this top-level supabase/migrations/
-- folder — a stray second migrations directory that drifted from the
-- one Supabase actually applies against in most workflows here. This
-- migration deliberately lives in the correct folder. The stray
-- src/supabase/migrations/ directory (and folding its migrations into
-- this one) is unaddressed cleanup for later.

CREATE TABLE IF NOT EXISTS carrier_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  carrier         text NOT NULL,
  is_connected    boolean NOT NULL DEFAULT false,
  credentials     jsonb NOT NULL DEFAULT '{}',
  use_test_mode   boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, carrier)
);

-- Grants (required)
grant select                         on public.carrier_connections to anon;
grant select, insert, update, delete on public.carrier_connections to authenticated;
grant select, insert, update, delete on public.carrier_connections to service_role;

-- RLS
ALTER TABLE carrier_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "carrier_connections_select" ON carrier_connections;
CREATE POLICY "carrier_connections_select" ON carrier_connections FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "carrier_connections_insert" ON carrier_connections;
CREATE POLICY "carrier_connections_insert" ON carrier_connections FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

DROP POLICY IF EXISTS "carrier_connections_update" ON carrier_connections;
CREATE POLICY "carrier_connections_update" ON carrier_connections FOR UPDATE
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

DROP POLICY IF EXISTS "carrier_connections_delete" ON carrier_connections;
CREATE POLICY "carrier_connections_delete" ON carrier_connections FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_carrier_connections_org ON carrier_connections(organization_id);

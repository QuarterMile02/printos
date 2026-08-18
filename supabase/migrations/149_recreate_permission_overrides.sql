-- ============================================================
-- Migration 149: Recreate permission_overrides (genuinely missing live)
-- Applied: PENDING — run manually in the Supabase SQL Editor (Ruben),
--   not auto-applied by Claude Code. See chat for context.
--
-- Confirmed missing, not a PostgREST schema-cache issue:
--   SELECT to_regclass('public.permission_overrides');  -- returned NULL
--
-- migration 011_users_permissions.sql (2026, this same repo) already
-- defines this table and its two RLS policies -- that CREATE TABLE
-- never actually landed live, even though the ALTER TABLE profiles
-- block earlier in the same file clearly did (we've directly observed
-- real profiles.role/tier data all session). Whatever happened, only
-- part of migration 011 ever ran. This migration recreates exactly
-- what 011 specifies for permission_overrides -- introspected from
-- that file, not guessed -- with one deliberate deviation on the RLS
-- policies, explained below.
-- ============================================================

CREATE TABLE IF NOT EXISTS permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  granted boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  note text,
  UNIQUE(user_id, permission_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON permission_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON permission_overrides TO service_role;

ALTER TABLE permission_overrides ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- RLS: kept as a genuine two-tier policy (view vs. manage), NOT
-- flattened to plain org-membership like this session's other
-- policies (portal_tiers, quotes, sales_orders, invoices, payments).
-- Deliberate deviation, flagging rather than silently deciding:
--
-- Every other table this session flattened RLS to plain org-
-- membership because the app's own routes switched to
-- createServiceClient() for the actual writes, making RLS pure
-- defense-in-depth -- the real gate is checkPermission() at the
-- application layer.
--
-- permission_overrides is different: api/settings/team/[id]/
-- permissions/route.ts's POST/DELETE handlers use the plain
-- cookie-bound client (getClient()), NOT service-role, for the
-- actual write. RLS is the ONLY thing standing between "any
-- authenticated staff member" and "can write arbitrary
-- permission_overrides rows for anyone" if this were flattened --
-- unlike portal_tiers, a bypass here is a direct privilege-
-- escalation path (a production/staff-tier employee could grant
-- themselves settings.team_members.manage = true via a raw
-- PostgREST call, sidestepping the route's own canManage check
-- entirely). This table IS the access-control system, so RLS
-- staying load-bearing here is intentional, not an oversight.
--
-- The org-scoping subquery below uses organization_members (this
-- session's established pattern) rather than 011's original
-- `profiles`-based subquery -- functionally equivalent (both
-- represent the same org relationship) but consistent with every
-- other policy written this session. Confirm this reasoning before
-- running -- if you'd rather flatten to plain org-membership like
-- the others, say so and I'll rewrite it.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "org members can view overrides" ON permission_overrides;
CREATE POLICY "org members can view overrides" ON permission_overrides
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "only owner or manager can manage overrides" ON permission_overrides;
CREATE POLICY "only owner or manager can manage overrides" ON permission_overrides
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND (role = 'owner' OR tier IN ('manager', 'lead'))
      AND organization_id = permission_overrides.organization_id
    )
  );

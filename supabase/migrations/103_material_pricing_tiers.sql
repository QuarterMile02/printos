-- ============================================================
-- Migration 103: material_pricing_tiers (backfill)
-- Applied: 2026-07-31
-- ============================================================
--
-- This table already exists in production — it was created directly
-- against Supabase (dashboard/SQL editor) when the Pricing Matrix
-- feature shipped, without a checked-in migration. This file backfills
-- that gap with `IF NOT EXISTS` so it's a safe no-op in production and
-- a real create on any fresh environment. Schema matches the live
-- table exactly, confirmed against every query site in
-- src/app/api/materials/[id]/pricing-tiers/, src/lib/pricing-tiers.ts,
-- and settings/materials/[id]/page.tsx.
--
-- Quantity-break tiers per material: [from_qty, to_qty] inclusive,
-- to_qty null = open-ended (e.g. "101+").

CREATE TABLE IF NOT EXISTS material_pricing_tiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id     uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  from_qty        numeric(12,4) NOT NULL,
  to_qty          numeric(12,4),
  cost            numeric(12,4) NOT NULL,
  price           numeric(12,4) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Grants (required)
grant select                         on public.material_pricing_tiers to anon;
grant select, insert, update, delete on public.material_pricing_tiers to authenticated;
grant select, insert, update, delete on public.material_pricing_tiers to service_role;

-- RLS
ALTER TABLE material_pricing_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "material_pricing_tiers_select" ON material_pricing_tiers;
CREATE POLICY "material_pricing_tiers_select" ON material_pricing_tiers FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "material_pricing_tiers_insert" ON material_pricing_tiers;
CREATE POLICY "material_pricing_tiers_insert" ON material_pricing_tiers FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role != 'viewer'));

DROP POLICY IF EXISTS "material_pricing_tiers_update" ON material_pricing_tiers;
CREATE POLICY "material_pricing_tiers_update" ON material_pricing_tiers FOR UPDATE
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role != 'viewer'));

DROP POLICY IF EXISTS "material_pricing_tiers_delete" ON material_pricing_tiers;
CREATE POLICY "material_pricing_tiers_delete" ON material_pricing_tiers FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_material_pricing_tiers_material ON material_pricing_tiers(material_id);
CREATE INDEX IF NOT EXISTS idx_material_pricing_tiers_org ON material_pricing_tiers(organization_id);

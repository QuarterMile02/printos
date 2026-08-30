-- ============================================================
-- Migration 169: material_product_types -- many-to-many junction linking
-- materials to product_types ("units of business").
-- Applied: PENDING -- run manually in the Supabase SQL Editor (Ruben),
--   not auto-applied by Claude Code.
-- ============================================================
--
-- "Unit of business" is NOT a distinct entity in this schema -- confirmed
-- via investigation, not assumed. Candidates checked:
--   - departments (14 rows) -- real table, but it's the job/crew-routing
--     dimension (jobs.department, product_categories.primary_department),
--     includes pure workflow stages with no revenue meaning at all
--     (installation, service_repair). Already has an exact junction
--     precedent for this shape (labor_rate_departments/
--     machine_rate_departments, migration 070) but the wrong semantic fit.
--   - The "8 units of business" on the TV Management Board
--     (MANAGEMENT_UNITS in display/board-config.ts) -- a hardcoded,
--     UI-only grouping of a SUBSET of department codes for one display.
--     Not a database entity at all.
--   - general_categories (sub_type industry/lead_source/machine/note/
--     pricing_level/tag, migration 089) -- unrelated tagging taxonomy for
--     quotes/jobs/assets, already flagged as its own orphaned-feature
--     concern separately. Not a UoB candidate.
--   - product_types (13 seeded rows, migration 067) -- THIS is the real
--     entity. products.product_type_id already exists as a single FK,
--     satisfying "a product belongs to ONE unit of business" exactly.
--     Its seeded names ("Signs / Large Format Printing", "Fleets /
--     Vehicle Wraps", "Commercial Printing", ...) directly match
--     Claudia's QuickBooks Item List income-account split cited for this
--     feature (4200 Signs / Large Format, 4300 Commercial Printing, 4600
--     Fleets / Vehicle Wraps) far more precisely than departments' plain
--     snake_case codes do. Live, actively maintained (Settings > Product
--     Types page tracks usage counts), not orphaned.
--
-- Same shape as the labor_rate_departments/machine_rate_departments
-- precedent (migration 070), just keyed by product_type_id instead of
-- department_id, and organization_id included directly (rather than only
-- reachable via the FK'd row) since materials, unlike labor/machine
-- rates, are also read from service-role bulk paths where an extra join
-- to resolve org would be one more round trip -- cheap to denormalize
-- here, enforced correct by the RLS policy below either way.
--
-- Purpose: a later, separate monthly export to QuickBooks that allocates
-- material cost to the correct unit-of-business expense account, for
-- materials CONSUMED (not sitting in inventory) -- see
-- known-issues/2026-08-21-material-units-of-business.md for why that
-- export isn't built yet (no data today distinguishes consumed vs.
-- inventory). This migration is only the classification data the export
-- will eventually need.

CREATE TABLE IF NOT EXISTS public.material_product_types (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  material_id     uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  product_type_id uuid NOT NULL REFERENCES public.product_types(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  UNIQUE(material_id, product_type_id)
);

CREATE INDEX IF NOT EXISTS idx_mpt_material     ON public.material_product_types(material_id);
CREATE INDEX IF NOT EXISTS idx_mpt_product_type ON public.material_product_types(product_type_id);
CREATE INDEX IF NOT EXISTS idx_mpt_org          ON public.material_product_types(organization_id);

GRANT SELECT                          ON public.material_product_types TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.material_product_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.material_product_types TO service_role;

ALTER TABLE public.material_product_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mpt_org_member" ON public.material_product_types;
CREATE POLICY "mpt_org_member"
  ON public.material_product_types
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
  );

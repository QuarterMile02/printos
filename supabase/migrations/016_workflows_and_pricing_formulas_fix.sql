-- Phase 7 cleanup migration. Two independent fixes bundled because the
-- user reported both gaps after running the products import:
--
--   1. pricing_formulas needs the description / sort_order / active columns
--      added (the seed in 014 was never applied, and a manual INSERT failed
--      on the missing description column). Re-seeds 9 ShopVOX dimension
--      capture modes as system formulas.
--
--   2. workflow_templates is missing 5 names that the ShopVOX product CSV
--      references. The 850 products imported in commit 9819fd6 came in with
--      workflow_template_id = NULL and produced 161 unresolved-workflow
--      warnings. Adding these rows lets future imports / manual edits link
--      products to the correct templates.
--
-- This migration is idempotent end-to-end:
--   - ADD COLUMN IF NOT EXISTS for the schema additions
--   - DELETE then INSERT for pricing_formulas (rowid churn is fine; nothing
--     FKs to pricing_formulas)
--   - WHERE NOT EXISTS guard on workflow_templates (case-insensitive on name)
--
-- IMPORTANT: pushing to git only checks this file in. Apply via the
-- Supabase SQL editor or `supabase db push`.
--
-- IMPORTANT: this DOES NOT retroactively link the 850 already-imported
-- products to the new workflow templates. The import set
-- workflow_template_id = NULL on every row whose Workflow column didn't
-- match an existing template; the original Workflow name from the CSV is
-- not stored anywhere on the products table, so there's no way to
-- back-fill from the DB alone. To finish the link, either:
--   (a) re-import a small "fix-only" CSV that contains just (Product Name,
--       Workflow Template) and a future products-update mode in the import
--       UI, or
--   (b) write per-product UPDATE statements based on the original CSV.
-- See the chat thread for which option the user chose.

-- ── 1. pricing_formulas: schema additions + reseed ──────────────────────────

ALTER TABLE pricing_formulas
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS sort_order  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active      boolean DEFAULT true;

DELETE FROM pricing_formulas;

INSERT INTO pricing_formulas
  (organization_id, name, formula, uom, description, sort_order, active, is_system)
VALUES
  (NULL, 'Area',                     'Width * Height',                     'Sqft',     'Width × Height — banners, vinyl, wall graphics, decals',         1, true, true),
  (NULL, 'Total Square Feet',        'TotalArea',                          'Sqft',     'User enters sqft directly — vehicle wraps',                       2, true, true),
  (NULL, 'Width',                    'Width',                              'Inches',   'Width only — roll materials, linear products',                    3, true, true),
  (NULL, 'Height',                   'Height',                             'Inches',   'Height only',                                                     4, true, true),
  (NULL, 'Perimeter',                '2 * (Width + Height)',               'Inches',   '2×(Width+Height) — channel letter outlines, frames',              5, true, true),
  (NULL, 'Volume',                   'Width * Height * Depth',             'Cu In',    'Width × Height × Depth — containers, dimensional products',       6, true, true),
  (NULL, 'Area in Square Yards',     '(Width / 36) * (Height / 36)',       'Sq Yd',    'Width × Height in square yards',                                  7, true, true),
  (NULL, 'Board Feet',               '(Width * Height * Thickness) / 144', 'Board Ft', 'W × H × Thickness ÷ 144 — lumber/wood products',                  8, true, true),
  (NULL, 'Cylindrical Surface Area', '2 * 3.14159 * (Radius + Height)',    'Sq In',    '2π × (radius + height) — pole wraps and cylindrical products',   9, true, true);

-- ── 2. workflow_templates: add 5 missing QMI templates ─────────────────────

INSERT INTO workflow_templates (organization_id, name, template_type, active)
SELECT v.organization_id, v.name, v.template_type, v.active
FROM (VALUES
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Design Only',                        'production', true),
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Digital Print w/Laminate & Kiss Cut','production', true),
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Removal Only',                       'production', true),
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Cut Vinyl w/ Assembly',              'production', true),
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Installation- Illuminated Sign',     'production', true)
) AS v(organization_id, name, template_type, active)
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_templates wt
  WHERE wt.organization_id = v.organization_id
    AND lower(wt.name) = lower(v.name)
);

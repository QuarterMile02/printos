-- Seed common pricing formulas.
-- Idempotent: re-running this migration is safe — rows are only inserted
-- when (organization_id, name) does not already exist.
--
-- Two passes:
--   1. Global / system formulas (organization_id IS NULL, is_system = true)
--      so every org sees them via the products page query
--      `.or('organization_id.eq.<org>,is_system.eq.true')`.
--   2. Org-specific copies for Quarter Mile Inc so the org can edit them
--      without affecting other tenants.

-- ── 1. System formulas ───────────────────────────────────────────────────────

INSERT INTO pricing_formulas (organization_id, name, formula, uom, is_system)
SELECT v.organization_id, v.name, v.formula, v.uom, v.is_system
FROM (VALUES
  (NULL::uuid, 'Area (Sqft)',      'width_in * height_in / 144',                                       'Sqft',      true),
  (NULL::uuid, 'Area (Sq In)',     'width_in * height_in',                                             'Sq In',     true),
  (NULL::uuid, 'Perimeter (Ft)',   '(width_in + height_in) * 2 / 12',                                  'Ft',        true),
  (NULL::uuid, 'Linear Feet',      'width_in / 12',                                                    'Linear Ft', true),
  (NULL::uuid, 'Each / Flat Rate', '1',                                                                'Each',      true),
  (NULL::uuid, 'Sheets',           'ceiling((width_in * height_in) / (sheet_width * sheet_height))',   'Sheet',     true)
) AS v(organization_id, name, formula, uom, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM pricing_formulas pf
  WHERE pf.organization_id IS NULL
    AND pf.name = v.name
);

-- ── 2. Org-specific copies for Quarter Mile Inc ──────────────────────────────

INSERT INTO pricing_formulas (organization_id, name, formula, uom, is_system)
SELECT v.organization_id, v.name, v.formula, v.uom, v.is_system
FROM (VALUES
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Area (Sqft)',      'width_in * height_in / 144',                                       'Sqft',      false),
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Area (Sq In)',     'width_in * height_in',                                             'Sq In',     false),
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Perimeter (Ft)',   '(width_in + height_in) * 2 / 12',                                  'Ft',        false),
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Linear Feet',      'width_in / 12',                                                    'Linear Ft', false),
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Each / Flat Rate', '1',                                                                'Each',      false),
  ('4ca12dff-97be-4472-8099-ab102a3af01a'::uuid, 'Sheets',           'ceiling((width_in * height_in) / (sheet_width * sheet_height))',   'Sheet',     false)
) AS v(organization_id, name, formula, uom, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM pricing_formulas pf
  WHERE pf.organization_id = v.organization_id
    AND pf.name = v.name
);

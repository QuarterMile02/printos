-- Resilient seed for pricing_formulas. Designed to be applied to a live DB
-- in any of these states:
--   • Original schema only (010 applied, none of 011–014 applied)
--   • Partial state from 011 / 012 / 013 / 014 having been applied in any order
--   • Already-correct state (re-running this is a no-op aside from row identity)
--
-- The previous seeds (011, 012, 013, 014) were never confirmed applied to the
-- live Supabase project — the user reported running a manual DELETE that
-- emptied the table and a manual INSERT that errored on a missing column.
-- This file consolidates everything those earlier migrations needed into a
-- single block of idempotent SQL that the Supabase SQL editor can run cleanly.
--
-- Three steps:
--   1. ADD COLUMN IF NOT EXISTS for description, sort_order, active
--      (additive — these columns are referenced by the seed below; existing
--      SELECT * queries don't break because the existing columns are
--      preserved unchanged)
--   2. DELETE FROM pricing_formulas — fresh slate
--   3. INSERT 9 system formulas (organization_id IS NULL, is_system = true).
--      They become visible to every tenant, including QMI, via the existing
--      `.or('organization_id.eq.<org>,is_system.eq.true')` query in
--      src/app/(dashboard)/dashboard/[slug]/products/[id]/page.tsx
--
-- IMPORTANT: pushing to git only checks this file in. To populate the live
-- DB you must apply it via the Supabase SQL editor or `supabase db push`.

-- ── 1. Schema additions ─────────────────────────────────────────────────────

ALTER TABLE pricing_formulas
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS sort_order  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active      boolean DEFAULT true;

-- ── 2. Wipe ─────────────────────────────────────────────────────────────────

DELETE FROM pricing_formulas;

-- ── 3. Re-seed (9 system formulas, in display order) ───────────────────────

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

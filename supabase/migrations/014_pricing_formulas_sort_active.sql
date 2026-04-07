-- Add sort_order + active columns to pricing_formulas and replace seed
-- with the 9 ShopVOX capture modes Quarter Mile Inc uses, in display order.
--
-- Three things this migration does:
--
-- 1. Additive schema change — adds `sort_order int` and `active bool`
--    columns. Both are nullable with defaults so existing code that does
--    SELECT * keeps working without TS or runtime breakage.
--
-- 2. Scoped DELETE — wipes only Quarter Mile Inc rows and system rows
--    (organization_id IS NULL). Other tenants' rows are preserved. This
--    matches the user's intent of "delete the QMI seed" rather than
--    "wipe everything for every org".
--
-- 3. Re-insert the 9 formulas as system rows with description, sort_order,
--    and active. Each row stores the literal ShopVOX expression in the
--    `formula` column (the schema name is `formula`, not `expression`,
--    despite ShopVOX's UI labeling). UOM is supplied because the schema
--    requires it (NOT NULL); see notes at the bottom of this file if any
--    of these need changing.
--
-- Supersedes 011 + 012 + 013. The DELETE wipes whatever those left behind.
-- All three older migrations stay in the repo for the timeline; no FKs
-- reference pricing_formulas so the DELETE is safe.
--
-- Note: pushing to git only checks the file in. To populate the live DB,
-- apply via the Supabase SQL editor or `supabase db push`.

-- ── 1. Schema additions ─────────────────────────────────────────────────────

ALTER TABLE pricing_formulas
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active     boolean DEFAULT true;

-- ── 2. Scoped wipe ──────────────────────────────────────────────────────────

DELETE FROM pricing_formulas
 WHERE organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a'
    OR organization_id IS NULL;

-- ── 3. Re-seed (9 system formulas, in order) ────────────────────────────────

INSERT INTO pricing_formulas
  (organization_id, name, formula, uom, description, sort_order, active, is_system)
VALUES
  (NULL, 'Area',                     'Width * Height',
    'Sqft',
    'Width × Height — use for banners, vinyl, wall graphics, decals. Toggle shows feet or inches.',
    1, true, true),

  (NULL, 'Total Square Feet',        'TotalArea',
    'Sqft',
    'User enters total sqft directly — use for vehicle wraps where dimensions vary.',
    2, true, true),

  (NULL, 'Width',                    'Width',
    'Inches',
    'Width only — use for roll materials, linear products charged per running foot.',
    3, true, true),

  (NULL, 'Height',                   'Height',
    'Inches',
    'Height only — use for products where only height affects cost.',
    4, true, true),

  (NULL, 'Perimeter',                '2 * (Width + Height)',
    'Inches',
    '2×(Width+Height) — use for channel letter outlines, frames, borders.',
    5, true, true),

  (NULL, 'Volume',                   'Width * Height * Depth',
    'Cu In',
    'Width × Height × Depth — use for containers, dimensional products.',
    6, true, true),

  (NULL, 'Area in Square Yards',     '(Width / 36) * (Height / 36)',
    'Sq Yd',
    'Width × Height in square yards.',
    7, true, true),

  (NULL, 'Board Feet',               '(Width * Height * Thickness) / 144',
    'Board Ft',
    'Width × Height × Thickness ÷ 144 — for lumber/wood products.',
    8, true, true),

  (NULL, 'Cylindrical Surface Area', '2 * 3.14159 * (Radius + Height)',
    'Sq In',
    '2π×(radius+height) — for pole wraps and cylindrical products.',
    9, true, true);

-- ── UOM notes (read me if numbers look wrong in the live UI) ────────────────
-- Area:     formula = Width * Height (sq inches). UOM = Sqft. The pricing
--           engine is expected to convert; if it doesn't, change UOM to
--           "Sq In" or change the formula to "Width * Height / 144".
-- Perimeter: formula gives inches; labeled "Inches". Switch to "Ft" with
--           "/ 12" if QMI quotes channel letter perimeters in feet.
-- Volume:   formula gives cubic inches; labeled "Cu In". Switch to "Cu Ft"
--           with "/ 1728" if needed.
-- Cylindrical Surface Area: the literal expression is the *perimeter of a
--           rectangle*, not a cylinder lateral area (which is
--           "2 * π * Radius * Height"). Inserted verbatim as you sent it
--           — flag if this needs correcting.

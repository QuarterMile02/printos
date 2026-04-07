-- Add description column to pricing_formulas and replace seed with the
-- 9 ShopVOX capture modes Quarter Mile Inc actually uses.
--
-- Each row's `formula` column holds the literal expression as ShopVOX
-- defines it. The pricing engine evaluates the expression in the input
-- units (typically inches) and the `uom` column is the display label.
-- Where the formula already converts (e.g. /36 for square yards or /144
-- for board feet) the uom matches the converted unit; where it doesn't
-- (e.g. plain Width * Height) the uom is the unit the user expects to
-- see, and the engine handles any final conversion.
--
-- Supersedes 011 + 012. The DELETE wipes everything those inserted (no
-- FK references — products store the chosen formula's NAME as a plain
-- text column, not as an FK).
--
-- This migration must be applied to Supabase manually (SQL editor or
-- `supabase db push`) — pushing the file to git only checks it in.

ALTER TABLE pricing_formulas
  ADD COLUMN IF NOT EXISTS description text;

DELETE FROM pricing_formulas;

INSERT INTO pricing_formulas (organization_id, name, formula, uom, description, is_system) VALUES
  (NULL, 'Area',                     'Width * Height',
    'Sqft',
    'Calculates total area from width and height. Use for banners, vinyl, wall graphics, decals.',
    true),
  (NULL, 'Total Square Feet',        'TotalArea',
    'Sqft',
    'User enters total sqft directly without width/height. Use for vehicle wraps.',
    true),
  (NULL, 'Width',                    'Width',
    'Inches',
    'Width measurement only. Use for roll materials and linear products.',
    true),
  (NULL, 'Height',                   'Height',
    'Inches',
    'Height measurement only.',
    true),
  (NULL, 'Perimeter',                '2 * (Width + Height)',
    'Inches',
    'Calculates perimeter. Use for channel letter outlines and frames.',
    true),
  (NULL, 'Volume',                   'Width * Height * Depth',
    'Cu In',
    'Calculates volume for containers.',
    true),
  (NULL, 'Area in Square Yards',     '(Width / 36) * (Height / 36)',
    'Sq Yd',
    'Area in square yards.',
    true),
  (NULL, 'Cylindrical Surface Area', '2 * 3.14159 * (Radius + Height)',
    'Sq In',
    'Surface area of a cylinder.',
    true),
  (NULL, 'Board Feet',               '(Width * Height * Thickness) / 144',
    'Board Ft',
    'Board feet for lumber/wood products.',
    true);

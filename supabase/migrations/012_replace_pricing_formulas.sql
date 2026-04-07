-- Replace pricing_formulas seed with ShopVOX dimension capture modes.
--
-- ShopVOX "pricing formulas" are NOT mathematical expressions — they are
-- dimension capture modes. Each one tells the UI which inputs to collect
-- from the user (Width only? W+H? Total Sqft directly?) and the pricing
-- engine handles the actual unit calculation downstream. The Tab 3
-- "Configure Pricing" dropdown only needs the canonical name from this
-- table.
--
-- This migration WIPES the pricing_formulas table (no FKs reference it —
-- products store the chosen formula's NAME as a plain text column) and
-- reseeds the 6 capture modes that cover everything Quarter Mile Inc
-- needs. They are inserted as system formulas (organization_id IS NULL,
-- is_system = true) so every org sees them via the existing OR query in
-- the products page loader:
--
--     .or('organization_id.eq.<org>,is_system.eq.true')
--
-- The "show feet/inches" toggle on Tab 3 controls how Area is displayed
-- — that's a per-product UI flag and is independent of this seed.
--
-- This supersedes 011_seed_pricing_formulas.sql which seeded math
-- expressions; ShopVOX doesn't work that way. 011 is left in the repo as
-- a historical record so timelines stay readable, but its rows are
-- removed by the DELETE below.

DELETE FROM pricing_formulas;

INSERT INTO pricing_formulas (organization_id, name, formula, uom, is_system) VALUES
  (NULL, 'Area',               'Area',             'Sqft',   true),
  (NULL, 'Total Square Feet',  'TotalSquareFeet',  'Sqft',   true),
  (NULL, 'Width',              'Width',            'Inches', true),
  (NULL, 'Height',             'Height',           'Inches', true),
  (NULL, 'Perimeter in Yards', 'PerimeterInYards', 'Yards',  true),
  (NULL, 'Volume',             'Volume',           'Cu Ft',  true);

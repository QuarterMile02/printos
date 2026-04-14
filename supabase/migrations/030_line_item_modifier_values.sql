-- Add modifier_values jsonb column to quote_line_items
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS modifier_values jsonb DEFAULT '{}';

-- Seed product_modifiers for Banner products with common modifiers
DO $$
DECLARE
  org_id uuid;
  banner_id uuid;
  mod_names text[] := ARRAY['WindSlits', 'Grommets_Corners', 'Lam_Reg_Gloss', 'Lam_Reg_Matte', 'Banner_Hem_Sides', 'Pole_Pocket_1in', 'Pole_Pocket_2in', 'Pole_Pocket_3in', 'Rush_Charge'];
  mod_name text;
  mod_id uuid;
BEGIN
  SELECT id INTO org_id FROM organizations LIMIT 1;
  IF org_id IS NULL THEN RETURN; END IF;

  -- Find first Banner product
  SELECT id INTO banner_id FROM products
    WHERE organization_id = org_id AND name ILIKE '%Banner%'
    LIMIT 1;
  IF banner_id IS NULL THEN RETURN; END IF;

  FOREACH mod_name IN ARRAY mod_names LOOP
    SELECT id INTO mod_id FROM modifiers
      WHERE organization_id = org_id AND system_lookup_name = mod_name
      LIMIT 1;
    IF mod_id IS NOT NULL THEN
      INSERT INTO product_modifiers (organization_id, product_id, modifier_id)
        VALUES (org_id, banner_id, mod_id)
        ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

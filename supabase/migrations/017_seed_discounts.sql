-- Migration 017: Seed ShopVOX discounts (discounts 1-14 of 19)
--
-- Why partial: discounts 15-19 live in /mnt/project/Discount_Ranges.pdf
-- which is not reachable from the agent environment that wrote this file.
-- Add discounts 15-19 in a follow-up migration once the tier data is
-- pasted inline or the archive is copied into the repo.
--
-- Idempotent: each discount is only inserted if a row with the same
-- (organization_id, name) does not already exist. Tier rows are written
-- inside the same DO block referencing the discount id we just captured.
--
-- Numeric note: discount_tiers.min_qty / max_qty are numeric(12,4) → max
-- 99,999,999.9999. Discount 6 was specified as "1-999999999=15" (9 nines),
-- which overflows. Truncated to 999999 (the same open-ended sentinel the
-- other 13 discounts already use).

DO $$
DECLARE
  v_org_id  uuid := '4ca12dff-97be-4472-8099-ab102a3af01a';
  v_disc_id uuid;
BEGIN
  -- ── 1. Arena 2x3ft Poster ────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Arena 2x3ft Poster') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Arena 2x3ft Poster', 'Range', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    0,     61, 13.6,  1),
      (v_disc_id,   62,    120, 10.0,  2),
      (v_disc_id,  121,    180,  6.0,  3),
      (v_disc_id,  181,    400,  7.0,  4),
      (v_disc_id,  401,    800,  8.0,  5),
      (v_disc_id,  801,   1600, 10.0,  6),
      (v_disc_id, 1601,   2400, 15.0,  7),
      (v_disc_id, 2401,   3200, 20.0,  8),
      (v_disc_id, 3201,   4800, 25.0,  9),
      (v_disc_id, 4801,   6400, 30.0, 10),
      (v_disc_id, 6401, 999999, 35.0, 11);
  END IF;

  -- ── 2. Business Cards ────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Business Cards') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Business Cards', 'Range', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,     0,   7999,  0.0, 1),
      (v_disc_id,  8000,  15999, 15.0, 2),
      (v_disc_id, 16000,  23999, 35.0, 3),
      (v_disc_id, 24000,  29999, 40.0, 4),
      (v_disc_id, 30000,  39999, 43.0, 5),
      (v_disc_id, 40000, 999999, 45.0, 6);
  END IF;

  -- ── 3. Coroplast Production Discounts ───────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Coroplast Production Discounts') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Coroplast Production Discounts', 'Range', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    0,     14, 12.0,  1),
      (v_disc_id,   15,     29, 18.5,  2),
      (v_disc_id,   30,     59, 21.0,  3),
      (v_disc_id,   60,    160, 23.5,  4),
      (v_disc_id,  161,    320, 29.0,  5),
      (v_disc_id,  321,    800, 31.5,  6),
      (v_disc_id,  801,   1199, 32.5,  7),
      (v_disc_id, 1200,   1499, 33.5,  8),
      (v_disc_id, 1500,   1600, 34.5,  9),
      (v_disc_id, 1601, 999999, 35.0, 10);
  END IF;

  -- ── 4. Global Range ──────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Global Range') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Global Range', 'Range', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id, 0, 2, 0.0, 1);
  END IF;

  -- ── 5. H Wire Stake Range ────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'H Wire Stake Range') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'H Wire Stake Range', 'Volume', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    1,      5,  0.0, 1),
      (v_disc_id,    6,     10, 15.0, 2),
      (v_disc_id,   11,     20, 20.0, 3),
      (v_disc_id,   21,     50, 25.0, 4),
      (v_disc_id,   51,    100, 30.0, 5),
      (v_disc_id,  101,    200, 35.0, 6),
      (v_disc_id,  201,    500, 40.0, 7),
      (v_disc_id,  501,   1000, 45.0, 8),
      (v_disc_id, 1001, 999999, 50.0, 9);
  END IF;

  -- ── 6. Laredo Heat Install Discount ─────────────────────────────────
  -- NOTE: source max was 999999999 (9 nines) — truncated to 999999 to fit
  -- numeric(12,4). Functionally identical: open-ended sentinel.
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Laredo Heat Install Discount') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Laredo Heat Install Discount', 'Price', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id, 1, 999999, 15.0, 1);
  END IF;

  -- ── 7. Online 18x24 Coroplast ───────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Online 18x24 Coroplast') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Online 18x24 Coroplast', 'Range', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    0,     14, 22.0,  1),
      (v_disc_id,   15,     29, 35.0,  2),
      (v_disc_id,   30,     59, 40.0,  3),
      (v_disc_id,   60,    160, 45.0,  4),
      (v_disc_id,  161,    320, 56.0,  5),
      (v_disc_id,  321,    800, 61.0,  6),
      (v_disc_id,  801,   1199, 63.0,  7),
      (v_disc_id, 1200,   1499, 65.0,  8),
      (v_disc_id, 1500,   1600, 67.0,  9),
      (v_disc_id, 1601, 999999, 68.0, 10);
  END IF;

  -- ── 8. Political Coroplast ───────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Political Coroplast') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Political Coroplast', 'Range', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    0,    160, 54.0, 1),
      (v_disc_id,  161,    320, 58.0, 2),
      (v_disc_id,  321,    415, 64.0, 3),
      (v_disc_id,  416,    800, 66.0, 4),
      (v_disc_id,  801,   1200, 66.0, 5),
      (v_disc_id, 1201,   1600, 67.0, 6),
      (v_disc_id, 1601,   2400, 67.0, 7),
      (v_disc_id, 2401,   3200, 69.0, 8),
      (v_disc_id, 3201, 999999, 70.0, 9);
  END IF;

  -- ── 9. Political Perforated ──────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Political Perforated') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Political Perforated', 'Range', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    0,    160, 10.0, 1),
      (v_disc_id,  161,    320, 15.0, 2),
      (v_disc_id,  321,    415, 20.0, 3),
      (v_disc_id,  416,    800, 25.0, 4),
      (v_disc_id,  801,   1200, 30.0, 5),
      (v_disc_id, 1201,   1600, 35.0, 6),
      (v_disc_id, 1601,   2400, 40.0, 7),
      (v_disc_id, 2401,   3200, 45.0, 8),
      (v_disc_id, 3201, 999999, 50.0, 9);
  END IF;

  -- ── 10. Political Vinyl ──────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Political Vinyl') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Political Vinyl', 'Range', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    0,     47, 22.0,  1),
      (v_disc_id,   48,    160, 44.0,  2),
      (v_disc_id,  161,    320, 48.0,  3),
      (v_disc_id,  321,    415, 54.0,  4),
      (v_disc_id,  416,    800, 56.0,  5),
      (v_disc_id,  801,   1200, 56.0,  6),
      (v_disc_id, 1201,   1600, 57.0,  7),
      (v_disc_id, 1601,   2400, 57.0,  8),
      (v_disc_id, 2401,   3200, 59.0,  9),
      (v_disc_id, 3201, 999999, 60.0, 10);
  END IF;

  -- ── 11. Retractable Range Material Test ─────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Retractable Range Material Test') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Retractable Range Material Test', 'Range', 'Material', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    0,  320,  0.0, 1),
      (v_disc_id,  321,  800,  5.0, 2),
      (v_disc_id,  801, 1600, 10.0, 3),
      (v_disc_id, 1601, 2400, 15.0, 4),
      (v_disc_id, 2401, 3200, 20.0, 5);
  END IF;

  -- ── 12. Retractable Range Product Test ──────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Retractable Range Product Test') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Retractable Range Product Test', 'Range', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    0,  320,  0.0, 1),
      (v_disc_id,  321,  800,  5.0, 2),
      (v_disc_id,  801, 1600, 10.0, 3),
      (v_disc_id, 1601, 2400, 15.0, 4),
      (v_disc_id, 2401, 3200, 20.0, 5),
      (v_disc_id, 3201, 4800, 25.0, 6);
  END IF;

  -- ── 13. Retractable Volume Material Test ────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Retractable Volume Material Test') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Retractable Volume Material Test', 'Volume', 'Material', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    0,  320,  0.0, 1),
      (v_disc_id,  321,  800,  5.0, 2),
      (v_disc_id,  801, 1600, 10.0, 3),
      (v_disc_id, 1601, 2400, 15.0, 4),
      (v_disc_id, 2401, 3200, 20.0, 5),
      (v_disc_id, 3201, 4800, 25.0, 6);
  END IF;

  -- ── 14. Retractable Volume Product Test ─────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM discounts WHERE organization_id = v_org_id AND name = 'Retractable Volume Product Test') THEN
    INSERT INTO discounts (organization_id, name, discount_type, applies_to, discount_by)
    VALUES (v_org_id, 'Retractable Volume Product Test', 'Volume', 'Product', 'Percentage')
    RETURNING id INTO v_disc_id;

    INSERT INTO discount_tiers (discount_id, min_qty, max_qty, discount_percent, sort_order) VALUES
      (v_disc_id,    0,  320,  0.0, 1),
      (v_disc_id,  321,  800,  5.0, 2),
      (v_disc_id,  801, 1600, 10.0, 3),
      (v_disc_id, 1601, 2400, 15.0, 4),
      (v_disc_id, 2401, 3200, 20.0, 5),
      (v_disc_id, 3201, 4800, 25.0, 6);
  END IF;
END $$;

-- Verify after running (paste these into the SQL editor separately):
-- SELECT name, discount_type, applies_to FROM discounts
--   WHERE organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' ORDER BY name;
-- SELECT d.name, t.min_qty, t.max_qty, t.discount_percent
--   FROM discount_tiers t JOIN discounts d ON d.id = t.discount_id
--   WHERE d.organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a'
--   ORDER BY d.name, t.sort_order;

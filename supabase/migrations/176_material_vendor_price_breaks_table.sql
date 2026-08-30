-- ============================================================
-- Migration 176: material_vendor_price_breaks -- new table. Build 1 item 4.
-- Applied: PROPOSED, NOT run. Requires 175 (material_vendors routing
-- fields) only for statement ordering conventions -- no direct column
-- dependency, but keep the paste order.
-- ============================================================
--
-- Genuinely new concept, not an extension of an existing table --
-- confirmed in Finding C: material_pricing_tiers (22 rows, 6 materials)
-- has no vendor_id, it's a material-level cost/price tier ("what does
-- this material cost at quantity N"), never vendor-scoped ("what does
-- THIS vendor charge at quantity N"). One material_vendors row today is
-- one price point, not a set of tiers, so quantity breaks need their
-- own table keyed to a specific material_vendors row.
--
-- qty_to NULL = applies at any quantity at/above qty_from -- how a
-- Skid/Pallet price behaves (per instruction). Enforced with a CHECK
-- rather than left to the app: qty_to, when present, must be >= qty_from.

-- ------------------------------------------------------------
-- STATEMENT 1 of 1 -- create table.
-- ------------------------------------------------------------
CREATE TABLE public.material_vendor_price_breaks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_vendor_id uuid NOT NULL REFERENCES public.material_vendors(id) ON DELETE CASCADE,
  qty_from           integer NOT NULL,
  qty_to             integer,
  price              numeric(12,4) NOT NULL,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (qty_from >= 0),
  CHECK (qty_to IS NULL OR qty_to >= qty_from)
);

DROP TRIGGER IF EXISTS set_material_vendor_price_breaks_updated_at ON public.material_vendor_price_breaks;
CREATE TRIGGER set_material_vendor_price_breaks_updated_at
  BEFORE UPDATE ON public.material_vendor_price_breaks
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- organization_id must match the parent material_vendors row's org --
-- same denormalization discipline as 173/174.
CREATE OR REPLACE FUNCTION sync_material_vendor_price_break_org() RETURNS trigger AS $$
BEGIN
  SELECT mv.organization_id INTO NEW.organization_id
    FROM public.material_vendors mv WHERE mv.id = NEW.material_vendor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'material_vendor_price_breaks.material_vendor_id % does not reference an existing material_vendors row', NEW.material_vendor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_material_vendor_price_break_org_trigger ON public.material_vendor_price_breaks;
CREATE TRIGGER sync_material_vendor_price_break_org_trigger
  BEFORE INSERT OR UPDATE OF material_vendor_id ON public.material_vendor_price_breaks
  FOR EACH ROW EXECUTE PROCEDURE sync_material_vendor_price_break_org();

CREATE INDEX idx_material_vendor_price_breaks_vendor ON public.material_vendor_price_breaks(material_vendor_id);
CREATE INDEX idx_material_vendor_price_breaks_org ON public.material_vendor_price_breaks(organization_id);

ALTER TABLE public.material_vendor_price_breaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage material_vendor_price_breaks" ON public.material_vendor_price_breaks
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_vendor_price_breaks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_vendor_price_breaks TO service_role;
REVOKE ALL ON public.material_vendor_price_breaks FROM anon;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_vendor_price_breaks' order by ordinal_position;
-- Expected: 8 columns.
--
-- -- Skid/Pallet open-ended behavior smoke test:
-- -- insert into public.material_vendor_price_breaks (material_vendor_id, qty_from, qty_to, price)
-- -- select id, 1, 9, 50.00 from public.material_vendors limit 1 returning id;
-- -- insert into public.material_vendor_price_breaks (material_vendor_id, qty_from, qty_to, price)
-- -- select id, 10, null, 40.00 from public.material_vendors limit 1 returning id;
-- -- (second row's null qty_to = "Skid/Pallet, applies at 10+")
-- -- delete from public.material_vendor_price_breaks where price in (50.00, 40.00);

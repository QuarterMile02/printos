-- ============================================================
-- Migration 174: material_colors -- new table. Build 1 item 2.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- is_stocked is per-colour, not a rule -- e.g. a vinyl material might
-- stock White/Black but special-order Red -- so it lives on this row,
-- not derived from anything on the parent material.

-- ------------------------------------------------------------
-- STATEMENT 1 of 1 -- create table.
-- ------------------------------------------------------------
CREATE TABLE public.material_colors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id        uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  name               text NOT NULL,
  code               text,
  vendor_part_number text,
  is_stocked         boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_material_colors_updated_at ON public.material_colors;
CREATE TRIGGER set_material_colors_updated_at
  BEFORE UPDATE ON public.material_colors
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Same organization_id-must-match-parent discipline as material_variants
-- (173) -- prevents a color row ever pointing at a material in a
-- different org.
CREATE OR REPLACE FUNCTION sync_material_color_org() RETURNS trigger AS $$
BEGIN
  SELECT m.organization_id INTO NEW.organization_id
    FROM public.materials m WHERE m.id = NEW.material_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'material_colors.material_id % does not reference an existing material', NEW.material_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_material_color_org_trigger ON public.material_colors;
CREATE TRIGGER sync_material_color_org_trigger
  BEFORE INSERT OR UPDATE OF material_id ON public.material_colors
  FOR EACH ROW EXECUTE PROCEDURE sync_material_color_org();

CREATE INDEX idx_material_colors_material ON public.material_colors(material_id);
CREATE INDEX idx_material_colors_org ON public.material_colors(organization_id);

ALTER TABLE public.material_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage material_colors" ON public.material_colors
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_colors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_colors TO service_role;
REVOKE ALL ON public.material_colors FROM anon;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_colors' order by ordinal_position;
-- Expected: 9 columns (id, organization_id, material_id, name, code, vendor_part_number, is_stocked, sort_order, created_at, updated_at -- 10 total).
--
-- select tgname from pg_trigger where tgrelid = 'public.material_colors'::regclass;
-- Expected: set_material_colors_updated_at, sync_material_color_org_trigger.

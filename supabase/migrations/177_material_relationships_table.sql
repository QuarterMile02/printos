-- ============================================================
-- Migration 177: material_relationships -- new table. Build 1 item 6.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- "Self-referencing, symmetric" for Corresponding Materials. DESIGN
-- CHOICE, flagged: rather than storing two mirrored rows (A->B and
-- B->A, kept in sync by a trigger, with the drift-risk that implies --
-- the exact "stale data" failure mode this whole redesign is working
-- to avoid elsewhere, e.g. payments.balance / material_variants'
-- generated columns), this stores ONE row per unordered pair, with a
-- CHECK forcing material_id_a < material_id_b. Symmetry is then just
-- "query with OR" (WHERE material_id_a = :id OR material_id_b = :id) --
-- there is no second row that could ever fall out of sync with the
-- first, because there is no second row.

-- ------------------------------------------------------------
-- STATEMENT 1 of 1 -- create table.
-- ------------------------------------------------------------
CREATE TABLE public.material_relationships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id_a   uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  material_id_b   uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (material_id_a < material_id_b),
  UNIQUE (material_id_a, material_id_b)
);

-- organization_id must match both materials' org (and both materials
-- must be in the same org as each other) -- same denormalization
-- discipline as 173/174/176.
CREATE OR REPLACE FUNCTION sync_material_relationship_org() RETURNS trigger AS $$
DECLARE
  org_a uuid;
  org_b uuid;
BEGIN
  SELECT organization_id INTO org_a FROM public.materials WHERE id = NEW.material_id_a;
  SELECT organization_id INTO org_b FROM public.materials WHERE id = NEW.material_id_b;
  IF org_a IS NULL OR org_b IS NULL THEN
    RAISE EXCEPTION 'material_relationships references a material_id that does not exist';
  END IF;
  IF org_a IS DISTINCT FROM org_b THEN
    RAISE EXCEPTION 'material_relationships cannot link materials from different organizations';
  END IF;
  NEW.organization_id := org_a;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_material_relationship_org_trigger ON public.material_relationships;
CREATE TRIGGER sync_material_relationship_org_trigger
  BEFORE INSERT OR UPDATE OF material_id_a, material_id_b ON public.material_relationships
  FOR EACH ROW EXECUTE PROCEDURE sync_material_relationship_org();

CREATE INDEX idx_material_relationships_a ON public.material_relationships(material_id_a);
CREATE INDEX idx_material_relationships_b ON public.material_relationships(material_id_b);
CREATE INDEX idx_material_relationships_org ON public.material_relationships(organization_id);

ALTER TABLE public.material_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage material_relationships" ON public.material_relationships
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_relationships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_relationships TO service_role;
REVOKE ALL ON public.material_relationships FROM anon;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_relationships' order by ordinal_position;
-- Expected: 5 columns.
--
-- -- App-layer note for Build 2: always insert with the lexicographically
-- -- (uuid text) smaller id as material_id_a to satisfy the CHECK, e.g.:
-- -- insert into material_relationships (material_id_a, material_id_b)
-- -- select least(id1, id2), greatest(id1, id2) ...
-- -- (uuid comparison in Postgres is byte-order, so LEAST/GREATEST work directly.)

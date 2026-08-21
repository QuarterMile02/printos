-- ============================================================
-- Migration 178: material_files -- new table. Build 1 item 7.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- Follows the existing assets library pattern (migration 112): file
-- bytes live in Supabase Storage (private `material-files` bucket,
-- created lazily by Build 2's upload server action, same as `assets`
-- and `proofs` already are), this table holds metadata + storage path
-- only.
--
-- file_type is a fixed 2-value set per the spec -- CHECK-constrained
-- rather than left open, since the spec gave the exact domain.

-- ------------------------------------------------------------
-- STATEMENT 1 of 1 -- create table.
-- ------------------------------------------------------------
CREATE TABLE public.material_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id     uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  file_type       text NOT NULL CHECK (file_type IN ('documentation', 'picture')),
  file_name       text NOT NULL,
  storage_path    text NOT NULL,
  mime_type       text,
  file_size       bigint NOT NULL DEFAULT 0,
  sort_order      integer NOT NULL DEFAULT 0,
  uploaded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_material_files_updated_at ON public.material_files;
CREATE TRIGGER set_material_files_updated_at
  BEFORE UPDATE ON public.material_files
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE OR REPLACE FUNCTION sync_material_file_org() RETURNS trigger AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id FROM public.materials WHERE id = NEW.material_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'material_files.material_id % does not reference an existing material', NEW.material_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_material_file_org_trigger ON public.material_files;
CREATE TRIGGER sync_material_file_org_trigger
  BEFORE INSERT OR UPDATE OF material_id ON public.material_files
  FOR EACH ROW EXECUTE PROCEDURE sync_material_file_org();

CREATE INDEX idx_material_files_material ON public.material_files(material_id);
CREATE INDEX idx_material_files_org ON public.material_files(organization_id);

ALTER TABLE public.material_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage material_files" ON public.material_files
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_files TO service_role;
REVOKE ALL ON public.material_files FROM anon;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_files' order by ordinal_position;
-- Expected: 11 columns.
--
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'public.material_files'::regclass and contype = 'c';
-- Expected: file_type check listing ('documentation','picture').

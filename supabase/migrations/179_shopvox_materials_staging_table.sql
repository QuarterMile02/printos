-- ============================================================
-- Migration 179: shopvox_materials -- new staging table. Build 1 item 9.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- GATING CHECK, done before writing this file, per instruction ("if the
-- scraper cannot currently read [ShopVOX's own id], STOP and report
-- that before building"): CONFIRMED the scraper already captures it.
-- `scripts/scrape-shopvox-material-tiers.js`'s discoverMaterials()
-- extracts a real ShopVOX material uuid from each list-row's href
-- (`materials/([0-9a-f-]{36})`, line 732), and extractOneMaterial()
-- returns that same `uuid` on every single scraped record (line 991) --
-- confirmed 0/1785 records missing it in the last real run's output
-- (scripts/shopvox-material-tiers-output.json). Not a blocker --
-- proceeding.
--
-- WHAT THIS TABLE CAPTURES ("every field the scraper writes today"):
-- Typed columns for everything the migrate-screen proposal logic (180)
-- actually needs to query/group/seed by, PLUS a `fields` jsonb catch-all
-- holding the complete raw 39-field capture from
-- _extractAllMaterialFields() (including the 2 report-only fields never
-- written to `materials` today -- cog_account, mystery_multiplier -- so
-- nothing the scraper reads is lost even though those two were never
-- written anywhere before). `vendor_pricing` and `pricing_tiers` jsonb
-- columns mirror the row shapes scripts/import-material-tiers.mjs
-- writes today to material_vendors / material_pricing_tiers
-- respectively -- same data, staged here instead of written live.
--
-- migrated_source_hash -- NOT in the spec's literal field list
-- (shopvox_id, source_hash, scraped_at, migrated_to_material_id,
-- migrated_at), added out of necessity, flagging explicitly: the spec
-- defines CHANGED as "linked, source_hash differs from the latest
-- scrape". But source_hash on THIS row IS always the latest scrape's
-- hash (it gets overwritten every re-scrape) -- it cannot differ from
-- itself. Telling MIGRATED apart from CHANGED requires remembering what
-- the hash WAS at the moment Ruben accepted the proposal, to compare
-- against what it IS now. migrated_source_hash is that snapshot, set
-- once when migrated_to_material_id is set, never touched by a re-scrape.
--
-- status is a GENERATED column (legal here -- unlike material_variants'
-- sqft, every input is a plain column on this SAME row, not a foreign
-- table) so NEW/MIGRATED/CHANGED is queryable/indexable directly,
-- matching the "three tabs" requirement without app-side status logic
-- duplicated in multiple places.
--
-- public.materials gets no status column and no FK back to this table
-- -- the separation is deliberate per instruction ("public.materials
-- holds ONLY real materials... that separation is the point").

-- ------------------------------------------------------------
-- STATEMENT 1 of 1 -- create table.
-- ------------------------------------------------------------
CREATE TABLE public.shopvox_materials (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  shopvox_id            uuid NOT NULL,
  name                  text NOT NULL,
  shopvox_status        text, -- 'enabled' | 'disabled', ShopVOX's own list-view status

  -- Resolved references (same lookup buildCandidateFromShopVoxFields
  -- already does today against material_types/material_categories) --
  -- kept alongside the raw label text in case a name lookup fails
  -- (renamed/new ShopVOX type not yet in PrintOS's catalog) so the
  -- proposal can still show what ShopVOX said even when unresolved.
  material_type_id      uuid REFERENCES public.material_types(id),
  category_id           uuid REFERENCES public.material_categories(id),
  material_type_raw     text,
  category_raw          text,

  -- The subset of the 37 write-eligible base fields the substrate
  -- proposal logic and Build 2 reporting need as typed, queryable
  -- columns. Everything (including these, redundantly) also lives in
  -- `fields` below for full fidelity.
  width                 numeric(10,4),
  height                numeric(10,4),
  sheet_cost            numeric(12,4),
  cost                  numeric(12,4),
  price                 numeric(12,4),
  multiplier            numeric(10,4),
  weight                numeric(10,4),
  preferred_vendor      text,
  part_number           text,
  sku                    text,
  po_description        text,
  info_url              text,
  image_url             text,
  description           text,

  -- Full raw capture -- see header comment.
  fields                jsonb NOT NULL DEFAULT '{}'::jsonb,
  vendor_pricing        jsonb NOT NULL DEFAULT '[]'::jsonb,
  pricing_tiers         jsonb NOT NULL DEFAULT '[]'::jsonb,

  source_hash           text NOT NULL,
  scraped_at            timestamptz NOT NULL,

  migrated_to_material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  migrated_at            timestamptz,
  migrated_source_hash   text, -- see header comment -- necessary addition, not in the literal spec list

  status text GENERATED ALWAYS AS (
    CASE
      WHEN migrated_to_material_id IS NULL THEN 'NEW'
      WHEN source_hash IS NOT DISTINCT FROM migrated_source_hash THEN 'MIGRATED'
      ELSE 'CHANGED'
    END
  ) STORED,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, shopvox_id)
);

DROP TRIGGER IF EXISTS set_shopvox_materials_updated_at ON public.shopvox_materials;
CREATE TRIGGER set_shopvox_materials_updated_at
  BEFORE UPDATE ON public.shopvox_materials
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE INDEX idx_shopvox_materials_org ON public.shopvox_materials(organization_id);
CREATE INDEX idx_shopvox_materials_status ON public.shopvox_materials(organization_id, status);
CREATE INDEX idx_shopvox_materials_type ON public.shopvox_materials(material_type_id);
CREATE INDEX idx_shopvox_materials_migrated_to ON public.shopvox_materials(migrated_to_material_id);

ALTER TABLE public.shopvox_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage shopvox_materials" ON public.shopvox_materials
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopvox_materials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopvox_materials TO service_role;
REVOKE ALL ON public.shopvox_materials FROM anon;

-- Verification:
-- select column_name, data_type, is_generated from information_schema.columns
-- where table_schema = 'public' and table_name = 'shopvox_materials' order by ordinal_position;
-- Expected: status shows is_generated = 'ALWAYS'; ~30 columns total.
--
-- -- Status derivation smoke test:
-- -- insert into shopvox_materials (organization_id, shopvox_id, name, source_hash, scraped_at)
-- -- values ('4ca12dff-97be-4472-8099-ab102a3af01a', gen_random_uuid(), 'Test Material', 'hash1', now())
-- -- returning status; -- expect 'NEW'
-- -- update shopvox_materials set migrated_to_material_id = (select id from materials limit 1), migrated_at = now(), migrated_source_hash = 'hash1' where name = 'Test Material' returning status; -- expect 'MIGRATED'
-- -- update shopvox_materials set source_hash = 'hash2' where name = 'Test Material' returning status; -- expect 'CHANGED'
-- -- delete from shopvox_materials where name = 'Test Material';

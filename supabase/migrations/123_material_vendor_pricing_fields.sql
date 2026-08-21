-- ============================================================
-- Migration 123: add ShopVOX "Vendor Price" columns to material_vendors
-- Applied: yes — confirmed live 2026-08-21 (material redesign Build 1,
-- Finding C): image_url/info_url/width/length/sqft_price/quantity all
-- exist on the live material_vendors table with real data (quantity/
-- length/sqft_price populated on all 893 rows). This header previously
-- read "NOT YET APPLIED", which was stale — corrected here, nothing
-- else in this file changed.
-- ============================================================
--
-- material_vendors already exists (010_product_builder_FIXED.sql), already has
-- RLS enabled and org-scoped select/insert/update/delete policies, and is
-- already granted to anon/authenticated/service_role (057_backfill_grants.sql).
-- Table-level GRANTs cover all columns including ones added later via ALTER
-- TABLE, so this migration needs no new GRANT or RLS statements — additive
-- columns only.
--
-- CONFIRMED LIVE (2026-08-09, against a real populated material — Acrylic
-- Clear .220in, 4 vendor-price rows, 3 distinct vendors) via
-- scripts/scrape-shopvox-material-tiers.js's extractVendorPricingSameVisit /
-- _extractVendorPricing — not reasoned from a screenshot alone. ShopVOX's
-- Vendor Price tab actually has 13 columns, not the 9 first spotted from a
-- cropped screenshot: Image, Quantity, Price, Rank, Part Number, Part Name,
-- Units, Info Url, Width, Length, Sqft Price, Vendor, Delivery Fee In Dollars.
--
-- Existing material_vendors columns already cover: Price → vendor_price,
-- Rank → rank, Part Number → part_number, Part Name → part_name,
-- Units → buying_units, Vendor → vendor_name, Delivery Fee → delivery_fee.
-- This migration adds the six that don't have an existing home.
--
-- RESOLVED (was an open question in the prior version of this migration):
-- confirmed live that "Quantity" stays flat at 1 across all 4 differently-
-- priced rows on the test material — it is NOT a quantity-break tier
-- threshold, just a column that happens to always read 1 in the data seen
-- so far. Kept as its own column regardless, since the real meaning across
-- other materials is still unconfirmed beyond this one sample.
--
-- CORRECTED (was assumed, now confirmed wrong): (material_id, vendor_name)
-- is NOT a safe unique/natural key — the same vendor can appear on more than
-- one row at different prices/ranks (confirmed live: "Grimco" appeared
-- twice on the test material, rank 2 at $118.20 and rank 3 at $96.31).
-- Import/upsert logic (not written yet) needs to key on something that
-- distinguishes these, e.g. (material_id, vendor_name, rank), or just
-- insert every row without a uniqueness constraint.

alter table public.material_vendors
  add column if not exists image_url text,
  add column if not exists info_url  text,
  add column if not exists width     numeric(10,4),
  add column if not exists length    numeric(10,4),
  add column if not exists sqft_price numeric(12,4),
  add column if not exists quantity  numeric(12,4);

comment on column public.material_vendors.image_url   is 'ShopVOX Vendor Price tab "Image" column — vendor/part thumbnail, distinct from materials.image_url (the material''s own photo). Frequently empty (confirmed: a placeholder icon renders instead of an <img> when unset) — null in that case.';
comment on column public.material_vendors.info_url    is 'ShopVOX Vendor Price tab "Info Url" column — vendor product page / spec sheet link.';
comment on column public.material_vendors.width       is 'ShopVOX Vendor Price tab "Width" column — confirmed live, e.g. sheet width in inches (48.0 on a real material).';
comment on column public.material_vendors.length      is 'ShopVOX Vendor Price tab "Length" column — confirmed live, e.g. sheet length in inches (96.0 on a real material).';
comment on column public.material_vendors.sqft_price  is 'ShopVOX Vendor Price tab "Sqft Price" column — confirmed live, ShopVOX''s own price-per-sqft figure for that row (not necessarily identical to vendor_price / (width*length/144) if ShopVOX rounds differently — stored as given rather than recomputed).';
comment on column public.material_vendors.quantity    is 'ShopVOX Vendor Price tab "Quantity" column — confirmed live to read 1 across all 4 rows on the one material tested so far; real-world range/meaning beyond that sample is still unconfirmed.';

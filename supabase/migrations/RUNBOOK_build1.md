# Build 1 Runbook — Material Redesign (Substrates)

Paste-ready, one statement per step, run directly in the Supabase SQL Editor.
100 steps total, numbered continuously across migrations 171–179 (the
`customer_display_name` rename is migration **180** and is deliberately
**not** in this runbook — see the note at the bottom).

**Conventions used below**, so the granularity is predictable:
- Every `ALTER TABLE ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`, `CREATE POLICY`,
  `CREATE OR REPLACE FUNCTION`, and each individual `GRANT ... TO <one role>` is
  its own step.
- The one exception: `DROP TRIGGER IF EXISTS x; CREATE TRIGGER x ...;` is kept
  together in one step. `DROP TRIGGER IF EXISTS` is a pure idempotency guard —
  on a brand-new table/trigger it is a guaranteed no-op with nothing of its own
  to verify — not a second piece of business logic. Everything else below is
  fully atomic, including splitting multi-index and multi-grant blocks that
  were combined in the migration *files* into separate runbook steps.
- Every step's SQL box contains code only — no comment header inside the box —
  per the instruction that a comment block sharing a box with SQL is exactly
  how migrations 140 and 152 reported success while running nothing.

---

## Step 1 — materials: add customer_display_name_active
```sql
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS customer_display_name_active boolean NOT NULL DEFAULT false;
```
**Verify:**
```sql
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'materials' and column_name = 'customer_display_name_active';
```
**Expect:** one row — `customer_display_name_active | boolean | false`

## Step 2 — materials: add description_active
```sql
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS description_active boolean NOT NULL DEFAULT false;
```
**Verify:**
```sql
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'materials' and column_name = 'description_active';
```
**Expect:** one row — `description_active | boolean | false`

## Step 3 — materials: add length_uom
```sql
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS length_uom text NOT NULL DEFAULT 'in'
    CHECK (length_uom IN ('in', 'ft', 'yd'));
```
**Verify:**
```sql
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'materials' and column_name = 'length_uom';
```
**Expect:** one row — `length_uom | text | 'in'::text`

## Step 4 — materials: add weight_divide_by
```sql
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS weight_divide_by numeric(12,4);
```
**Verify:**
```sql
select column_name, data_type, numeric_precision, numeric_scale from information_schema.columns
where table_schema = 'public' and table_name = 'materials' and column_name = 'weight_divide_by';
```
**Expect:** one row — `weight_divide_by | numeric | 12 | 4`

## Step 5 — materials: add shelf_life_months
```sql
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS shelf_life_months integer;
```
**Verify:**
```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'materials' and column_name = 'shelf_life_months';
```
**Expect:** one row — `shelf_life_months | integer`

## Step 6 — materials: add shelf_clock_from
```sql
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS shelf_clock_from text;
```
**Verify:**
```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'materials' and column_name = 'shelf_clock_from';
```
**Expect:** one row — `shelf_clock_from | text`

## Step 7 — materials: add expiry_warn_at
```sql
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS expiry_warn_at integer;
```
**Verify:**
```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'materials' and column_name = 'expiry_warn_at';
```
**Expect:** one row — `expiry_warn_at | integer`

## Step 8 — materials: add price_band
```sql
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS price_band text;
```
**Verify:**
```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'materials' and column_name = 'price_band';
```
**Expect:** one row — `price_band | text`

---

## Step 9 — delivery_methods: create table
```sql
CREATE TABLE public.delivery_methods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  is_scheduled    boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
```
**Verify:**
```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'delivery_methods' order by ordinal_position;
```
**Expect:** 8 rows (id, organization_id, name, is_scheduled, sort_order, is_active, created_at, updated_at).

## Step 10 — delivery_methods: updated_at trigger
```sql
DROP TRIGGER IF EXISTS set_delivery_methods_updated_at ON public.delivery_methods;
CREATE TRIGGER set_delivery_methods_updated_at
  BEFORE UPDATE ON public.delivery_methods
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.delivery_methods'::regclass and tgname = 'set_delivery_methods_updated_at';
```
**Expect:** one row.

## Step 11 — delivery_methods: enable RLS
```sql
ALTER TABLE public.delivery_methods ENABLE ROW LEVEL SECURITY;
```
**Verify:**
```sql
select relrowsecurity from pg_class where oid = 'public.delivery_methods'::regclass;
```
**Expect:** `true`

## Step 12 — delivery_methods: policy
```sql
CREATE POLICY "org members can manage delivery_methods" ON public.delivery_methods
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
```
**Verify:**
```sql
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'delivery_methods';
```
**Expect:** one row — `org members can manage delivery_methods | ALL`

## Step 13 — delivery_methods: index
```sql
CREATE INDEX idx_delivery_methods_org ON public.delivery_methods(organization_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'delivery_methods' and indexname = 'idx_delivery_methods_org';
```
**Expect:** one row.

## Step 14 — delivery_methods: grant authenticated
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_methods TO authenticated;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'delivery_methods' and grantee = 'authenticated' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 15 — delivery_methods: grant service_role
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_methods TO service_role;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'delivery_methods' and grantee = 'service_role' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 16 — delivery_methods: revoke anon ⚠️
```sql
REVOKE ALL ON public.delivery_methods FROM anon;
```
**Verify:**
```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'delivery_methods' and grantee = 'anon';
```
**Expect:** 0 rows. If this returns any row, `anon` still has a privilege on this table — do not proceed.

## Step 17 — delivery_methods: seed the 6 methods, all orgs
```sql
INSERT INTO public.delivery_methods (organization_id, name, is_scheduled, sort_order)
SELECT o.id, v.name, v.is_scheduled, v.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Local Delivery',     true,  0),
  ('Vendor Truck',       true,  1),
  ('From Manufacturer',  false, 2),
  ('Freight / LTL',      false, 3),
  ('Ground',             false, 4),
  ('Will Call',          false, 5)
) AS v(name, is_scheduled, sort_order)
ON CONFLICT (organization_id, name) DO NOTHING;
```
**Verify:**
```sql
select name, is_scheduled, sort_order from public.delivery_methods
where organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' order by sort_order;
```
**Expect:** 6 rows — Local Delivery(true)/Vendor Truck(true)/From Manufacturer(false)/Freight / LTL(false)/Ground(false)/Will Call(false), in that order.

---

## Step 18 — material_variants: create table
```sql
CREATE TABLE public.material_variants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id      uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  height           numeric(10,4),
  width            numeric(10,4),
  length_increment numeric(10,4),
  thickness        numeric(10,4),
  core_diameter    numeric(10,4),
  direction        text,
  shipping_cost    numeric(12,4),
  base_cost        numeric(12,4),
  multiplier       numeric(10,4) NOT NULL DEFAULT 1,
  min_qty          integer,
  max_qty          integer,
  on_hand          numeric(12,4),
  is_default       boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,
  length_uom       text NOT NULL DEFAULT 'in' CHECK (length_uom IN ('in', 'ft', 'yd')),
  sqft numeric(12,4) GENERATED ALWAYS AS (
    CASE
      WHEN height IS NULL OR width IS NULL THEN NULL
      WHEN length_uom = 'in' THEN round((height * width) / 144.0, 4)
      WHEN length_uom = 'ft' THEN round(height * width, 4)
      WHEN length_uom = 'yd' THEN round((height * width) * 9.0, 4)
      ELSE NULL
    END
  ) STORED,
  total_cost numeric(12,4) GENERATED ALWAYS AS (
    CASE WHEN base_cost IS NULL THEN NULL ELSE base_cost + COALESCE(shipping_cost, 0) END
  ) STORED,
  cost_per_unit numeric(12,4) GENERATED ALWAYS AS (
    CASE
      WHEN base_cost IS NULL THEN NULL
      WHEN height IS NOT NULL AND width IS NOT NULL AND
           (CASE length_uom
              WHEN 'in' THEN (height * width) / 144.0
              WHEN 'ft' THEN height * width
              WHEN 'yd' THEN (height * width) * 9.0
              ELSE NULL
            END) > 0
      THEN round(
             (base_cost + COALESCE(shipping_cost, 0)) /
             (CASE length_uom
                WHEN 'in' THEN (height * width) / 144.0
                WHEN 'ft' THEN height * width
                WHEN 'yd' THEN (height * width) * 9.0
                ELSE NULL
              END), 4)
      ELSE round(base_cost + COALESCE(shipping_cost, 0), 4)
    END
  ) STORED,
  sell_per_unit numeric(12,4) GENERATED ALWAYS AS (
    CASE
      WHEN base_cost IS NULL OR multiplier IS NULL THEN NULL
      ELSE round(
        (CASE
           WHEN height IS NOT NULL AND width IS NOT NULL AND
                (CASE length_uom
                   WHEN 'in' THEN (height * width) / 144.0
                   WHEN 'ft' THEN height * width
                   WHEN 'yd' THEN (height * width) * 9.0
                   ELSE NULL
                 END) > 0
           THEN (base_cost + COALESCE(shipping_cost, 0)) /
                (CASE length_uom
                   WHEN 'in' THEN (height * width) / 144.0
                   WHEN 'ft' THEN height * width
                   WHEN 'yd' THEN (height * width) * 9.0
                   ELSE NULL
                 END)
           ELSE (base_cost + COALESCE(shipping_cost, 0))
         END) * multiplier, 4)
    END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (min_qty IS NULL OR max_qty IS NULL OR min_qty <= max_qty)
);
```
**Verify:**
```sql
select column_name, is_generated, generation_expression is not null as has_expr
from information_schema.columns
where table_schema = 'public' and table_name = 'material_variants' and is_generated = 'ALWAYS'
order by column_name;
```
**Expect:** 4 rows — `cost_per_unit`, `sell_per_unit`, `sqft`, `total_cost`, each `is_generated = ALWAYS`.

## Step 19 — material_variants: updated_at trigger
```sql
DROP TRIGGER IF EXISTS set_material_variants_updated_at ON public.material_variants;
CREATE TRIGGER set_material_variants_updated_at
  BEFORE UPDATE ON public.material_variants
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.material_variants'::regclass and tgname = 'set_material_variants_updated_at';
```
**Expect:** one row.

## Step 20 — material_variants: one-default-per-material index
```sql
CREATE UNIQUE INDEX idx_material_variants_one_default
  ON public.material_variants(material_id) WHERE is_default;
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_variants' and indexname = 'idx_material_variants_one_default';
```
**Expect:** one row.

## Step 21 — material_variants: material_id index
```sql
CREATE INDEX idx_material_variants_material ON public.material_variants(material_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_variants' and indexname = 'idx_material_variants_material';
```
**Expect:** one row.

## Step 22 — material_variants: organization_id index
```sql
CREATE INDEX idx_material_variants_org ON public.material_variants(organization_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_variants' and indexname = 'idx_material_variants_org';
```
**Expect:** one row.

## Step 23 — material_variants: enable RLS
```sql
ALTER TABLE public.material_variants ENABLE ROW LEVEL SECURITY;
```
**Verify:**
```sql
select relrowsecurity from pg_class where oid = 'public.material_variants'::regclass;
```
**Expect:** `true`

## Step 24 — material_variants: policy
```sql
CREATE POLICY "org members can manage material_variants" ON public.material_variants
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
```
**Verify:**
```sql
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'material_variants';
```
**Expect:** one row — `org members can manage material_variants | ALL`

## Step 25 — material_variants: grant authenticated
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_variants TO authenticated;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_variants' and grantee = 'authenticated' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 26 — material_variants: grant service_role
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_variants TO service_role;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_variants' and grantee = 'service_role' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 27 — material_variants: revoke anon ⚠️
```sql
REVOKE ALL ON public.material_variants FROM anon;
```
**Verify:**
```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_variants' and grantee = 'anon';
```
**Expect:** 0 rows. If this returns any row, `anon` still has a privilege on this table — do not proceed.

## Step 28 — material_variants: sync-from-parent function
```sql
CREATE OR REPLACE FUNCTION sync_material_variant_from_parent() RETURNS trigger AS $$
BEGIN
  SELECT m.organization_id, m.length_uom
    INTO NEW.organization_id, NEW.length_uom
    FROM public.materials m
   WHERE m.id = NEW.material_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'material_variants.material_id % does not reference an existing material', NEW.material_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```
**Verify:**
```sql
select proname from pg_proc where proname = 'sync_material_variant_from_parent' and pronamespace = 'public'::regnamespace;
```
**Expect:** one row.

## Step 29 — material_variants: sync-from-parent trigger
```sql
DROP TRIGGER IF EXISTS sync_material_variant_before_write ON public.material_variants;
CREATE TRIGGER sync_material_variant_before_write
  BEFORE INSERT OR UPDATE OF material_id ON public.material_variants
  FOR EACH ROW EXECUTE PROCEDURE sync_material_variant_from_parent();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.material_variants'::regclass and tgname = 'sync_material_variant_before_write';
```
**Expect:** one row.

## Step 30 — materials: cascade length_uom function
```sql
CREATE OR REPLACE FUNCTION cascade_material_length_uom() RETURNS trigger AS $$
BEGIN
  IF NEW.length_uom IS DISTINCT FROM OLD.length_uom THEN
    UPDATE public.material_variants
       SET length_uom = NEW.length_uom
     WHERE material_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```
**Verify:**
```sql
select proname from pg_proc where proname = 'cascade_material_length_uom' and pronamespace = 'public'::regnamespace;
```
**Expect:** one row.

## Step 31 — materials: cascade length_uom trigger
```sql
DROP TRIGGER IF EXISTS cascade_material_length_uom_trigger ON public.materials;
CREATE TRIGGER cascade_material_length_uom_trigger
  AFTER UPDATE OF length_uom ON public.materials
  FOR EACH ROW EXECUTE PROCEDURE cascade_material_length_uom();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.materials'::regclass and tgname = 'cascade_material_length_uom_trigger';
```
**Expect:** one row.

## Step 32 — material_variants: functional smoke test (generated columns)
```sql
INSERT INTO public.material_variants (material_id, height, width, base_cost, shipping_cost, multiplier, is_default)
SELECT id, 48, 96, 100, 20, 2.0, true FROM public.materials
WHERE organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' LIMIT 1
RETURNING id, length_uom, sqft, total_cost, cost_per_unit, sell_per_unit;
```
**Verify:**
```sql
select length_uom, sqft, total_cost, cost_per_unit, sell_per_unit
from public.material_variants where sqft = 32.0000 and total_cost = 120.0000;
```
**Expect:** one row — `length_uom='in'`, `sqft=32.0000` (48×96/144), `total_cost=120.0000`, `cost_per_unit=3.7500` (120/32), `sell_per_unit=7.5000`.

## Step 33 — material_variants: clean up the smoke-test row
```sql
DELETE FROM public.material_variants WHERE sqft = 32.0000 AND total_cost = 120.0000 AND sell_per_unit = 7.5000;
```
**Verify:**
```sql
select count(*) from public.material_variants;
```
**Expect:** `0`

---

## Step 34 — material_colors: create table
```sql
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
```
**Verify:**
```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'material_colors' order by ordinal_position;
```
**Expect:** 10 rows.

## Step 35 — material_colors: updated_at trigger
```sql
DROP TRIGGER IF EXISTS set_material_colors_updated_at ON public.material_colors;
CREATE TRIGGER set_material_colors_updated_at
  BEFORE UPDATE ON public.material_colors
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.material_colors'::regclass and tgname = 'set_material_colors_updated_at';
```
**Expect:** one row.

## Step 36 — material_colors: sync-org function
```sql
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
```
**Verify:**
```sql
select proname from pg_proc where proname = 'sync_material_color_org' and pronamespace = 'public'::regnamespace;
```
**Expect:** one row.

## Step 37 — material_colors: sync-org trigger
```sql
DROP TRIGGER IF EXISTS sync_material_color_org_trigger ON public.material_colors;
CREATE TRIGGER sync_material_color_org_trigger
  BEFORE INSERT OR UPDATE OF material_id ON public.material_colors
  FOR EACH ROW EXECUTE PROCEDURE sync_material_color_org();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.material_colors'::regclass and tgname = 'sync_material_color_org_trigger';
```
**Expect:** one row.

## Step 38 — material_colors: material_id index
```sql
CREATE INDEX idx_material_colors_material ON public.material_colors(material_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_colors' and indexname = 'idx_material_colors_material';
```
**Expect:** one row.

## Step 39 — material_colors: organization_id index
```sql
CREATE INDEX idx_material_colors_org ON public.material_colors(organization_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_colors' and indexname = 'idx_material_colors_org';
```
**Expect:** one row.

## Step 40 — material_colors: enable RLS
```sql
ALTER TABLE public.material_colors ENABLE ROW LEVEL SECURITY;
```
**Verify:**
```sql
select relrowsecurity from pg_class where oid = 'public.material_colors'::regclass;
```
**Expect:** `true`

## Step 41 — material_colors: policy
```sql
CREATE POLICY "org members can manage material_colors" ON public.material_colors
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
```
**Verify:**
```sql
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'material_colors';
```
**Expect:** one row — `org members can manage material_colors | ALL`

## Step 42 — material_colors: grant authenticated
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_colors TO authenticated;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_colors' and grantee = 'authenticated' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 43 — material_colors: grant service_role
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_colors TO service_role;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_colors' and grantee = 'service_role' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 44 — material_colors: revoke anon ⚠️
```sql
REVOKE ALL ON public.material_colors FROM anon;
```
**Verify:**
```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_colors' and grantee = 'anon';
```
**Expect:** 0 rows. If this returns any row, `anon` still has a privilege on this table — do not proceed.

---

## Step 45 — material_vendors: add is_preferred
```sql
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS is_preferred boolean NOT NULL DEFAULT false;
```
**Verify:**
```sql
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'material_vendors' and column_name = 'is_preferred';
```
**Expect:** one row — `is_preferred | boolean | false`

## Step 46 — material_vendors: one-preferred-per-material index
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_vendors_one_preferred
  ON public.material_vendors(material_id) WHERE is_preferred;
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_vendors' and indexname = 'idx_material_vendors_one_preferred';
```
**Expect:** one row.

## Step 47 — material_vendors: add vendor_part_number
```sql
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS vendor_part_number text;
```
**Verify:**
```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'material_vendors' and column_name = 'vendor_part_number';
```
**Expect:** one row — `vendor_part_number | text`

## Step 48 — material_vendors: add sku
```sql
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS sku text;
```
**Verify:**
```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'material_vendors' and column_name = 'sku';
```
**Expect:** one row — `sku | text`

## Step 49 — material_vendors: add delivery_method_id
```sql
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS delivery_method_id uuid REFERENCES public.delivery_methods(id) ON DELETE SET NULL;
```
**Verify:**
```sql
select conname from pg_constraint where conrelid = 'public.material_vendors'::regclass and contype = 'f' and conname like '%delivery_method%';
```
**Expect:** one row.

## Step 50 — material_vendors: delivery_method_id index
```sql
CREATE INDEX IF NOT EXISTS idx_material_vendors_delivery_method ON public.material_vendors(delivery_method_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_vendors' and indexname = 'idx_material_vendors_delivery_method';
```
**Expect:** one row.

## Step 51 — material_vendors: add delivery_days
```sql
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS delivery_days text[];
```
**Verify:**
```sql
select column_name, udt_name from information_schema.columns
where table_schema = 'public' and table_name = 'material_vendors' and column_name = 'delivery_days';
```
**Expect:** one row — `delivery_days | _text`

## Step 52 — material_vendors: add lead_time_days, free_delivery, po_description
```sql
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS lead_time_days integer,
  ADD COLUMN IF NOT EXISTS free_delivery boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS po_description text;
```
**Verify:**
```sql
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'material_vendors'
  and column_name in ('lead_time_days', 'free_delivery', 'po_description')
order by column_name;
```
**Expect:** 3 rows — `free_delivery | boolean | false`, `lead_time_days | integer | null`, `po_description | text | null`.

---

## Step 53 — material_vendor_price_breaks: create table
```sql
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
```
**Verify:**
```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'material_vendor_price_breaks' order by ordinal_position;
```
**Expect:** 8 rows.

## Step 54 — material_vendor_price_breaks: updated_at trigger
```sql
DROP TRIGGER IF EXISTS set_material_vendor_price_breaks_updated_at ON public.material_vendor_price_breaks;
CREATE TRIGGER set_material_vendor_price_breaks_updated_at
  BEFORE UPDATE ON public.material_vendor_price_breaks
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.material_vendor_price_breaks'::regclass and tgname = 'set_material_vendor_price_breaks_updated_at';
```
**Expect:** one row.

## Step 55 — material_vendor_price_breaks: sync-org function
```sql
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
```
**Verify:**
```sql
select proname from pg_proc where proname = 'sync_material_vendor_price_break_org' and pronamespace = 'public'::regnamespace;
```
**Expect:** one row.

## Step 56 — material_vendor_price_breaks: sync-org trigger
```sql
DROP TRIGGER IF EXISTS sync_material_vendor_price_break_org_trigger ON public.material_vendor_price_breaks;
CREATE TRIGGER sync_material_vendor_price_break_org_trigger
  BEFORE INSERT OR UPDATE OF material_vendor_id ON public.material_vendor_price_breaks
  FOR EACH ROW EXECUTE PROCEDURE sync_material_vendor_price_break_org();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.material_vendor_price_breaks'::regclass and tgname = 'sync_material_vendor_price_break_org_trigger';
```
**Expect:** one row.

## Step 57 — material_vendor_price_breaks: material_vendor_id index
```sql
CREATE INDEX idx_material_vendor_price_breaks_vendor ON public.material_vendor_price_breaks(material_vendor_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_vendor_price_breaks' and indexname = 'idx_material_vendor_price_breaks_vendor';
```
**Expect:** one row.

## Step 58 — material_vendor_price_breaks: organization_id index
```sql
CREATE INDEX idx_material_vendor_price_breaks_org ON public.material_vendor_price_breaks(organization_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_vendor_price_breaks' and indexname = 'idx_material_vendor_price_breaks_org';
```
**Expect:** one row.

## Step 59 — material_vendor_price_breaks: enable RLS
```sql
ALTER TABLE public.material_vendor_price_breaks ENABLE ROW LEVEL SECURITY;
```
**Verify:**
```sql
select relrowsecurity from pg_class where oid = 'public.material_vendor_price_breaks'::regclass;
```
**Expect:** `true`

## Step 60 — material_vendor_price_breaks: policy
```sql
CREATE POLICY "org members can manage material_vendor_price_breaks" ON public.material_vendor_price_breaks
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
```
**Verify:**
```sql
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'material_vendor_price_breaks';
```
**Expect:** one row — `org members can manage material_vendor_price_breaks | ALL`

## Step 61 — material_vendor_price_breaks: grant authenticated
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_vendor_price_breaks TO authenticated;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_vendor_price_breaks' and grantee = 'authenticated' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 62 — material_vendor_price_breaks: grant service_role
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_vendor_price_breaks TO service_role;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_vendor_price_breaks' and grantee = 'service_role' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 63 — material_vendor_price_breaks: revoke anon ⚠️
```sql
REVOKE ALL ON public.material_vendor_price_breaks FROM anon;
```
**Verify:**
```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_vendor_price_breaks' and grantee = 'anon';
```
**Expect:** 0 rows. If this returns any row, `anon` still has a privilege on this table — do not proceed.

---

## Step 64 — material_relationships: create table
```sql
CREATE TABLE public.material_relationships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id_a   uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  material_id_b   uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (material_id_a < material_id_b),
  UNIQUE (material_id_a, material_id_b)
);
```
**Verify:**
```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'material_relationships' order by ordinal_position;
```
**Expect:** 5 rows.

## Step 65 — material_relationships: sync-org function
```sql
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
```
**Verify:**
```sql
select proname from pg_proc where proname = 'sync_material_relationship_org' and pronamespace = 'public'::regnamespace;
```
**Expect:** one row.

## Step 66 — material_relationships: sync-org trigger
```sql
DROP TRIGGER IF EXISTS sync_material_relationship_org_trigger ON public.material_relationships;
CREATE TRIGGER sync_material_relationship_org_trigger
  BEFORE INSERT OR UPDATE OF material_id_a, material_id_b ON public.material_relationships
  FOR EACH ROW EXECUTE PROCEDURE sync_material_relationship_org();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.material_relationships'::regclass and tgname = 'sync_material_relationship_org_trigger';
```
**Expect:** one row.

## Step 67 — material_relationships: material_id_a index
```sql
CREATE INDEX idx_material_relationships_a ON public.material_relationships(material_id_a);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_relationships' and indexname = 'idx_material_relationships_a';
```
**Expect:** one row.

## Step 68 — material_relationships: material_id_b index
```sql
CREATE INDEX idx_material_relationships_b ON public.material_relationships(material_id_b);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_relationships' and indexname = 'idx_material_relationships_b';
```
**Expect:** one row.

## Step 69 — material_relationships: organization_id index
```sql
CREATE INDEX idx_material_relationships_org ON public.material_relationships(organization_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_relationships' and indexname = 'idx_material_relationships_org';
```
**Expect:** one row.

## Step 70 — material_relationships: enable RLS
```sql
ALTER TABLE public.material_relationships ENABLE ROW LEVEL SECURITY;
```
**Verify:**
```sql
select relrowsecurity from pg_class where oid = 'public.material_relationships'::regclass;
```
**Expect:** `true`

## Step 71 — material_relationships: policy
```sql
CREATE POLICY "org members can manage material_relationships" ON public.material_relationships
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
```
**Verify:**
```sql
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'material_relationships';
```
**Expect:** one row — `org members can manage material_relationships | ALL`

## Step 72 — material_relationships: grant authenticated
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_relationships TO authenticated;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_relationships' and grantee = 'authenticated' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 73 — material_relationships: grant service_role
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_relationships TO service_role;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_relationships' and grantee = 'service_role' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 74 — material_relationships: revoke anon ⚠️
```sql
REVOKE ALL ON public.material_relationships FROM anon;
```
**Verify:**
```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_relationships' and grantee = 'anon';
```
**Expect:** 0 rows. If this returns any row, `anon` still has a privilege on this table — do not proceed.

---

## Step 75 — material_files: create table
```sql
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
```
**Verify:**
```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'material_files' order by ordinal_position;
```
**Expect:** 11 rows.

## Step 76 — material_files: updated_at trigger
```sql
DROP TRIGGER IF EXISTS set_material_files_updated_at ON public.material_files;
CREATE TRIGGER set_material_files_updated_at
  BEFORE UPDATE ON public.material_files
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.material_files'::regclass and tgname = 'set_material_files_updated_at';
```
**Expect:** one row.

## Step 77 — material_files: sync-org function
```sql
CREATE OR REPLACE FUNCTION sync_material_file_org() RETURNS trigger AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id FROM public.materials WHERE id = NEW.material_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'material_files.material_id % does not reference an existing material', NEW.material_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```
**Verify:**
```sql
select proname from pg_proc where proname = 'sync_material_file_org' and pronamespace = 'public'::regnamespace;
```
**Expect:** one row.

## Step 78 — material_files: sync-org trigger
```sql
DROP TRIGGER IF EXISTS sync_material_file_org_trigger ON public.material_files;
CREATE TRIGGER sync_material_file_org_trigger
  BEFORE INSERT OR UPDATE OF material_id ON public.material_files
  FOR EACH ROW EXECUTE PROCEDURE sync_material_file_org();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.material_files'::regclass and tgname = 'sync_material_file_org_trigger';
```
**Expect:** one row.

## Step 79 — material_files: material_id index
```sql
CREATE INDEX idx_material_files_material ON public.material_files(material_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_files' and indexname = 'idx_material_files_material';
```
**Expect:** one row.

## Step 80 — material_files: organization_id index
```sql
CREATE INDEX idx_material_files_org ON public.material_files(organization_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'material_files' and indexname = 'idx_material_files_org';
```
**Expect:** one row.

## Step 81 — material_files: enable RLS
```sql
ALTER TABLE public.material_files ENABLE ROW LEVEL SECURITY;
```
**Verify:**
```sql
select relrowsecurity from pg_class where oid = 'public.material_files'::regclass;
```
**Expect:** `true`

## Step 82 — material_files: policy
```sql
CREATE POLICY "org members can manage material_files" ON public.material_files
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
```
**Verify:**
```sql
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'material_files';
```
**Expect:** one row — `org members can manage material_files | ALL`

## Step 83 — material_files: grant authenticated
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_files TO authenticated;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_files' and grantee = 'authenticated' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 84 — material_files: grant service_role
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_files TO service_role;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_files' and grantee = 'service_role' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 85 — material_files: revoke anon ⚠️
```sql
REVOKE ALL ON public.material_files FROM anon;
```
**Verify:**
```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'material_files' and grantee = 'anon';
```
**Expect:** 0 rows. If this returns any row, `anon` still has a privilege on this table — do not proceed.

---

## Step 86 — shopvox_materials: create table
```sql
CREATE TABLE public.shopvox_materials (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shopvox_id            uuid NOT NULL,
  name                  text NOT NULL,
  shopvox_status        text,
  material_type_id      uuid REFERENCES public.material_types(id),
  category_id           uuid REFERENCES public.material_categories(id),
  material_type_raw     text,
  category_raw          text,
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
  fields                jsonb NOT NULL DEFAULT '{}'::jsonb,
  vendor_pricing        jsonb NOT NULL DEFAULT '[]'::jsonb,
  pricing_tiers         jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_hash           text NOT NULL,
  scraped_at            timestamptz NOT NULL,
  migrated_to_material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  migrated_at            timestamptz,
  migrated_source_hash   text,
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
```
**Verify:**
```sql
select column_name, is_generated from information_schema.columns
where table_schema = 'public' and table_name = 'shopvox_materials' and is_generated = 'ALWAYS';
```
**Expect:** one row — `status | ALWAYS`.

## Step 87 — shopvox_materials: updated_at trigger
```sql
DROP TRIGGER IF EXISTS set_shopvox_materials_updated_at ON public.shopvox_materials;
CREATE TRIGGER set_shopvox_materials_updated_at
  BEFORE UPDATE ON public.shopvox_materials
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
```
**Verify:**
```sql
select tgname from pg_trigger where tgrelid = 'public.shopvox_materials'::regclass and tgname = 'set_shopvox_materials_updated_at';
```
**Expect:** one row.

## Step 88 — shopvox_materials: organization_id index
```sql
CREATE INDEX idx_shopvox_materials_org ON public.shopvox_materials(organization_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'shopvox_materials' and indexname = 'idx_shopvox_materials_org';
```
**Expect:** one row.

## Step 89 — shopvox_materials: status index
```sql
CREATE INDEX idx_shopvox_materials_status ON public.shopvox_materials(organization_id, status);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'shopvox_materials' and indexname = 'idx_shopvox_materials_status';
```
**Expect:** one row.

## Step 90 — shopvox_materials: material_type_id index
```sql
CREATE INDEX idx_shopvox_materials_type ON public.shopvox_materials(material_type_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'shopvox_materials' and indexname = 'idx_shopvox_materials_type';
```
**Expect:** one row.

## Step 91 — shopvox_materials: migrated_to_material_id index
```sql
CREATE INDEX idx_shopvox_materials_migrated_to ON public.shopvox_materials(migrated_to_material_id);
```
**Verify:**
```sql
select indexname from pg_indexes where tablename = 'shopvox_materials' and indexname = 'idx_shopvox_materials_migrated_to';
```
**Expect:** one row.

## Step 92 — shopvox_materials: enable RLS
```sql
ALTER TABLE public.shopvox_materials ENABLE ROW LEVEL SECURITY;
```
**Verify:**
```sql
select relrowsecurity from pg_class where oid = 'public.shopvox_materials'::regclass;
```
**Expect:** `true`

## Step 93 — shopvox_materials: policy
```sql
CREATE POLICY "org members can manage shopvox_materials" ON public.shopvox_materials
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));
```
**Verify:**
```sql
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'shopvox_materials';
```
**Expect:** one row — `org members can manage shopvox_materials | ALL`

## Step 94 — shopvox_materials: grant authenticated
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopvox_materials TO authenticated;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'shopvox_materials' and grantee = 'authenticated' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 95 — shopvox_materials: grant service_role
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopvox_materials TO service_role;
```
**Verify:**
```sql
select privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'shopvox_materials' and grantee = 'service_role' order by privilege_type;
```
**Expect:** 4 rows — DELETE, INSERT, SELECT, UPDATE.

## Step 96 — shopvox_materials: revoke anon ⚠️
```sql
REVOKE ALL ON public.shopvox_materials FROM anon;
```
**Verify:**
```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'shopvox_materials' and grantee = 'anon';
```
**Expect:** 0 rows. If this returns any row, `anon` still has a privilege on this table — do not proceed.

## Step 97 — shopvox_materials: status smoke test — NEW
```sql
INSERT INTO public.shopvox_materials (organization_id, shopvox_id, name, source_hash, scraped_at)
VALUES ('4ca12dff-97be-4472-8099-ab102a3af01a', gen_random_uuid(), 'RUNBOOK_TEST_MATERIAL', 'hash1', now())
RETURNING status;
```
**Verify:**
```sql
select status from public.shopvox_materials where name = 'RUNBOOK_TEST_MATERIAL';
```
**Expect:** `NEW`

## Step 98 — shopvox_materials: status smoke test — MIGRATED
```sql
UPDATE public.shopvox_materials
SET migrated_to_material_id = (SELECT id FROM public.materials WHERE organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' LIMIT 1),
    migrated_at = now(),
    migrated_source_hash = 'hash1'
WHERE name = 'RUNBOOK_TEST_MATERIAL';
```
**Verify:**
```sql
select status from public.shopvox_materials where name = 'RUNBOOK_TEST_MATERIAL';
```
**Expect:** `MIGRATED`

## Step 99 — shopvox_materials: status smoke test — CHANGED
```sql
UPDATE public.shopvox_materials SET source_hash = 'hash2' WHERE name = 'RUNBOOK_TEST_MATERIAL';
```
**Verify:**
```sql
select status from public.shopvox_materials where name = 'RUNBOOK_TEST_MATERIAL';
```
**Expect:** `CHANGED`

## Step 100 — shopvox_materials: clean up the smoke-test row
```sql
DELETE FROM public.shopvox_materials WHERE name = 'RUNBOOK_TEST_MATERIAL';
```
**Verify:**
```sql
select count(*) from public.shopvox_materials where name = 'RUNBOOK_TEST_MATERIAL';
```
**Expect:** `0`

---

## Not in this runbook

**`180_materials_rename_external_name_HOLD_FOR_BUILD2.sql`** — the
`external_name → customer_display_name` rename. Deliberately excluded.
`external_name` is read/written in 24 files today; running the rename before
Build 2 updates those call sites breaks material create/edit, the materials
list, and the CSV export immediately. Run it only after Build 2 ships, as its
own separate action — not part of this runbook.

After step 100, the schema is complete and `scripts/backfill-shopvox-materials.mjs --execute`
can run (dry-run already confirmed 1785/1788 materials will get a `shopvox_id`).

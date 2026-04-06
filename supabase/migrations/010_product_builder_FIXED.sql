-- PrintOS Product Builder Schema v6 - FIXED
-- Separates RLS for org-scoped tables vs child tables

-- ── ORG-SCOPED TABLES ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pricing_formulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, formula text NOT NULL, uom text NOT NULL,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES profiles(id), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, material_type_id uuid REFERENCES material_types(id),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, secondary_category text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS labor_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, external_name text,
  cost numeric(12,4) NOT NULL DEFAULT 0, price numeric(12,4) NOT NULL DEFAULT 0,
  markup numeric(8,4) NOT NULL DEFAULT 2.01,
  setup_charge numeric(12,4) DEFAULT 0, machine_charge numeric(12,4) DEFAULT 0, other_charge numeric(12,4) DEFAULT 0,
  formula text DEFAULT 'Unit', units text DEFAULT 'Hr',
  include_in_base_price boolean DEFAULT false, per_li_unit boolean DEFAULT false,
  production_rate numeric(12,4), production_rate_units text, production_rate_per text,
  production_factor numeric(8,4), production_rate_prompt text, production_rate_prompt_detail text,
  volume_discount_id uuid, cog_account text, cog_account_number text, qb_item_type text,
  description text, display_name_in_line_item boolean DEFAULT false,
  display_description_in_line_item boolean DEFAULT false, show_internal boolean DEFAULT true,
  sop_url text, video_url text, used_in_products jsonb DEFAULT '[]'::jsonb,
  department_id uuid REFERENCES departments(id), profit_margin_pct numeric(8,4),
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), created_by uuid REFERENCES profiles(id),
  updated_at timestamptz DEFAULT now(), updated_by uuid REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS machine_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, external_name text,
  cost numeric(12,4) NOT NULL DEFAULT 0, price numeric(12,4) NOT NULL DEFAULT 0,
  markup numeric(8,4) NOT NULL DEFAULT 2.5,
  setup_charge numeric(12,4) DEFAULT 0, other_charge numeric(12,4) DEFAULT 0, labor_charge numeric(12,4) DEFAULT 0,
  formula text DEFAULT 'Area', units text DEFAULT 'Sqft',
  include_in_base_price boolean DEFAULT false, per_li_unit boolean DEFAULT false,
  production_rate numeric(12,4), production_rate_units text, production_rate_per text,
  equipment_replacement_value numeric(12,2), equipment_useful_life_years numeric(5,1),
  markup_for_replacement numeric(5,4), monthly_operating_hours numeric(6,1),
  monthly_maintenance_cost numeric(10,2), monthly_lease_payment numeric(10,2),
  replacement_reserve_per_hr numeric(10,4), operating_cost_per_hr numeric(10,4),
  volume_discount_id uuid, cog_account text, cog_account_number text, qb_item_type text,
  description text, display_name_in_line_item boolean DEFAULT false,
  display_description_in_line_item boolean DEFAULT false, show_internal boolean DEFAULT true,
  sop_url text, video_url text,
  department_id uuid REFERENCES departments(id),
  cloned_from_labor_rate_id uuid REFERENCES labor_rates(id),
  profit_margin_pct numeric(8,4), active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), created_by uuid REFERENCES profiles(id),
  updated_at timestamptz DEFAULT now(), updated_by uuid REFERENCES profiles(id)
);

ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS cloned_from_machine_rate_id uuid REFERENCES machine_rates(id);

CREATE TABLE IF NOT EXISTS materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, external_name text, description text, po_description text,
  material_type_id uuid REFERENCES material_types(id),
  category_id uuid REFERENCES material_categories(id),
  cost numeric(12,4) NOT NULL DEFAULT 0, price numeric(12,4) NOT NULL DEFAULT 0,
  multiplier numeric(8,4) DEFAULT 2.0, buying_units text, selling_units text,
  sell_buy_ratio numeric(12,4) DEFAULT 1.0, conversion_factor numeric(12,4), per_li_unit text,
  width numeric(10,4), height numeric(10,4), fixed_side text, fixed_quantity numeric(10,4), sheet_cost numeric(12,4),
  wastage_markup numeric(8,4) DEFAULT 0, calculate_wastage boolean DEFAULT false, allow_variants boolean DEFAULT false,
  labor_charge numeric(12,4) DEFAULT 0, machine_charge numeric(12,4) DEFAULT 0,
  other_charge numeric(12,4) DEFAULT 0, setup_charge numeric(12,4) DEFAULT 0,
  formula text DEFAULT 'Area', discount_id uuid, discount text,
  track_inventory boolean DEFAULT false, in_use boolean DEFAULT true,
  weight numeric(10,4), weight_uom text,
  cog_account_name text, cog_account_number numeric(10,0), qb_item_type text,
  preferred_vendor text, part_number text, sku text,
  display_name_in_line_item text, show_internal boolean DEFAULT false,
  show_external boolean DEFAULT false, print_image_on_pdf boolean DEFAULT false,
  info_url text, image_url text,
  include_in_base_price boolean DEFAULT false, percentage_of_base numeric(8,4),
  remnant_width numeric(10,4), remnant_length numeric(10,4),
  remnant_location text, remnant_usable boolean DEFAULT false,
  last_price_update timestamptz, price_change_alert_threshold numeric(5,2) DEFAULT 5.0,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), created_by uuid REFERENCES profiles(id),
  updated_at timestamptz DEFAULT now(), updated_by uuid REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS material_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  material_id uuid REFERENCES materials(id) ON DELETE CASCADE,
  vendor_name text NOT NULL, vendor_price numeric(12,4) NOT NULL,
  rank integer DEFAULT 1, buying_units text, length_per_unit numeric(10,4),
  part_name text, part_number text, delivery_fee numeric(10,2) DEFAULT 0,
  min_stock_level numeric(10,4), max_stock_level numeric(10,4), min_order_value numeric(10,2),
  last_price_date timestamptz DEFAULT now(), previous_price numeric(12,4),
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, display_name text NOT NULL, system_lookup_name text,
  modifier_type text NOT NULL CHECK (modifier_type IN ('Boolean', 'Numeric', 'Range')),
  units text, range_min_label text, range_max_label text,
  range_min_value numeric(10,4), range_max_value numeric(10,4),
  range_default_value numeric(10,4), range_step_interval numeric(10,4),
  show_internally boolean DEFAULT true, show_customer boolean DEFAULT true,
  is_system_variable boolean DEFAULT false, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), created_by uuid REFERENCES profiles(id),
  updated_at timestamptz DEFAULT now(), updated_by uuid REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('Range', 'Volume', 'Price')),
  applies_to text NOT NULL CHECK (applies_to IN ('Product', 'Material', 'Both')),
  discount_by text NOT NULL DEFAULT 'Percentage' CHECK (discount_by IN ('Percentage', 'Fixed Price')),
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), created_by uuid REFERENCES profiles(id),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, description text, template_type text DEFAULT 'production',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), created_by uuid REFERENCES profiles(id),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, description text, pricing_type text DEFAULT 'Formula',
  formula text DEFAULT 'Area', active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, description text, part_number text, sku numeric(20,0), upc numeric(20,0),
  category_id uuid REFERENCES product_categories(id), secondary_category text, product_type text,
  pricing_type text DEFAULT 'Formula' CHECK (pricing_type IN ('Formula', 'Basic', 'Grid', 'Cost Plus')),
  pricing_method text DEFAULT 'Standard', formula text DEFAULT 'Area', show_feet_inches boolean DEFAULT true,
  cost numeric(12,4) DEFAULT 0, buying_cost numeric(12,4) DEFAULT 0,
  price numeric(12,4) DEFAULT 0, markup numeric(8,4) DEFAULT 2.0,
  buying_units text DEFAULT 'Each', units text DEFAULT 'Each', conversion_factor numeric(12,4) DEFAULT 1,
  min_line_price numeric(12,4), min_unit_price numeric(12,4),
  volume_discount_id uuid REFERENCES discounts(id), range_discount_id uuid REFERENCES discounts(id),
  workflow_template_id uuid REFERENCES workflow_templates(id),
  income_account text, income_account_number text,
  cog_account text, cog_account_number numeric(10,0),
  asset_account text, asset_account_number numeric(10,0),
  qb_item_type text, default_sale_type text DEFAULT 'In House',
  taxable boolean DEFAULT true, in_house_commission boolean DEFAULT false,
  outsourced_commission boolean DEFAULT false, track_inventory boolean DEFAULT false,
  include_base_product_in_po boolean DEFAULT false, print_image_on_pdf boolean DEFAULT false,
  image_url text, production_details text,
  published boolean DEFAULT false, published_at timestamptz, published_by uuid REFERENCES profiles(id),
  pricing_template_id uuid REFERENCES product_templates(id),
  complexity_value integer DEFAULT 3 CHECK (complexity_value BETWEEN 1 AND 5),
  status text DEFAULT 'published' CHECK (status IN ('draft', 'published', 'disabled', 'archived')),
  active boolean DEFAULT true, rounding integer DEFAULT 2, tax numeric(10,4),
  created_at timestamptz DEFAULT now(), created_by uuid REFERENCES profiles(id),
  updated_at timestamptz DEFAULT now(), updated_by uuid REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS material_pricing_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, description text, discount_percent numeric(8,4) DEFAULT 0,
  active boolean DEFAULT true, created_at timestamptz DEFAULT now()
);

-- ── CHILD TABLES (no organization_id — security via parent) ──────────────────

CREATE TABLE IF NOT EXISTS discount_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_id uuid REFERENCES discounts(id) ON DELETE CASCADE,
  min_qty numeric(12,4) NOT NULL, max_qty numeric(12,4),
  discount_percent numeric(8,4), fixed_price numeric(12,4), sort_order integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_template_id uuid REFERENCES workflow_templates(id) ON DELETE CASCADE,
  name text NOT NULL, description text, sort_order integer DEFAULT 0,
  department_id uuid REFERENCES departments(id),
  estimated_time_minutes numeric(10,2), time_formula text,
  machine_rate_id uuid REFERENCES machine_rates(id),
  labor_rate_id uuid REFERENCES labor_rates(id),
  stage_phase text DEFAULT 'production',
  requires_proof boolean DEFAULT false, requires_customer_approval boolean DEFAULT false,
  requires_qc boolean DEFAULT false, can_track_time boolean DEFAULT true,
  api_auto_advance boolean DEFAULT false, qr_scan_advance boolean DEFAULT false,
  voice_command_advance boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_default_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('Material', 'LaborRate', 'MachineRate', 'CustomItem')),
  material_id uuid REFERENCES materials(id), labor_rate_id uuid REFERENCES labor_rates(id),
  machine_rate_id uuid REFERENCES machine_rates(id),
  custom_item_name text, custom_item_cost numeric(12,4), custom_item_price numeric(12,4),
  menu_name text, system_formula text DEFAULT 'Area', item_kind text DEFAULT 'Company Items',
  charge_per_li_unit boolean DEFAULT false, include_in_base_price boolean DEFAULT false,
  multiplier numeric(8,4) DEFAULT 1.0, fixed_quantity numeric(10,4), percentage_of_base numeric(8,4),
  is_optional boolean DEFAULT false, is_required boolean DEFAULT false, sort_order integer DEFAULT 0,
  overrides_material_category_id uuid REFERENCES material_categories(id),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  modifier_id uuid REFERENCES modifiers(id),
  sort_order integer DEFAULT 0, is_required boolean DEFAULT false,
  default_value text, linked_dropdown_item_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_dropdown_menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  menu_name text NOT NULL, sort_order integer DEFAULT 0, is_optional boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_dropdown_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  dropdown_menu_id uuid REFERENCES product_dropdown_menus(id) ON DELETE CASCADE,
  item_type text CHECK (item_type IN ('Material', 'LaborRate', 'MachineRate')),
  material_id uuid REFERENCES materials(id),
  labor_rate_id uuid REFERENCES labor_rates(id),
  machine_rate_id uuid REFERENCES machine_rates(id),
  item_kind text DEFAULT 'Company Items', system_formula text DEFAULT 'Area',
  charge_per_li_unit boolean DEFAULT false, include_in_base_price boolean DEFAULT false,
  multiplier numeric(8,4) DEFAULT 1.0, fixed_quantity numeric(10,4),
  percentage_of_base numeric(8,4), is_optional boolean DEFAULT true,
  reference_tag text, sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  field_type text CHECK (field_type IN ('text', 'textarea', 'radio', 'color', 'dropdown')),
  field_group text, placeholder text, default_value text,
  is_required boolean DEFAULT false, print_on_customer_pdf boolean DEFAULT false,
  print_on_po boolean DEFAULT false, sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE pricing_formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_default_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_dropdown_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_dropdown_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_pricing_levels ENABLE ROW LEVEL SECURITY;

-- RLS for org-scoped tables
DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY[
    'pricing_formulas','material_types','material_categories','product_categories',
    'departments','labor_rates','machine_rates','materials','material_vendors',
    'modifiers','discounts','workflow_templates','workflow_stages',
    'products','product_default_items','product_modifiers','product_dropdown_menus',
    'product_dropdown_items','product_custom_fields','material_pricing_levels','product_templates'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('CREATE POLICY "%s_select" ON %s FOR SELECT USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))', tbl, tbl);
    EXECUTE format('CREATE POLICY "%s_insert" ON %s FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role != ''viewer''))', tbl, tbl);
    EXECUTE format('CREATE POLICY "%s_update" ON %s FOR UPDATE USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role != ''viewer''))', tbl, tbl);
    EXECUTE format('CREATE POLICY "%s_delete" ON %s FOR DELETE USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role IN (''owner'', ''admin'')))', tbl, tbl);
  END LOOP;
END $$;

-- RLS for discount_tiers (child table — security via parent discount)
CREATE POLICY "discount_tiers_select" ON discount_tiers FOR SELECT
  USING (discount_id IN (SELECT id FROM discounts WHERE organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())));
CREATE POLICY "discount_tiers_insert" ON discount_tiers FOR INSERT
  WITH CHECK (discount_id IN (SELECT id FROM discounts WHERE organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role != 'viewer')));
CREATE POLICY "discount_tiers_update" ON discount_tiers FOR UPDATE
  USING (discount_id IN (SELECT id FROM discounts WHERE organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role != 'viewer')));
CREATE POLICY "discount_tiers_delete" ON discount_tiers FOR DELETE
  USING (discount_id IN (SELECT id FROM discounts WHERE organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))));

-- ── INDEXES ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_labor_rates_org ON labor_rates(organization_id);
CREATE INDEX IF NOT EXISTS idx_labor_rates_active ON labor_rates(organization_id, active);
CREATE INDEX IF NOT EXISTS idx_machine_rates_org ON machine_rates(organization_id);
CREATE INDEX IF NOT EXISTS idx_materials_org ON materials(organization_id);
CREATE INDEX IF NOT EXISTS idx_materials_type ON materials(material_type_id);
CREATE INDEX IF NOT EXISTS idx_materials_active ON materials(organization_id, active);
CREATE INDEX IF NOT EXISTS idx_material_vendors_material ON material_vendors(material_id);
CREATE INDEX IF NOT EXISTS idx_products_org ON products(organization_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_product_default_items_product ON product_default_items(product_id);
CREATE INDEX IF NOT EXISTS idx_modifiers_org ON modifiers(organization_id);
CREATE INDEX IF NOT EXISTS idx_workflow_stages_template ON workflow_stages(workflow_template_id);
CREATE INDEX IF NOT EXISTS idx_discounts_org ON discounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_discount_tiers_discount ON discount_tiers(discount_id);

-- ── SEED: PRICING FORMULAS ────────────────────────────────────────────────────

INSERT INTO pricing_formulas (name, formula, uom, is_system) VALUES
  ('Area', 'Width*Height', 'Sqft', true),
  ('Area in Sqyd', 'Width_in_yards*Height_in_yards', 'SqYd', true),
  ('Perimeter', '2*(Width+Height)', 'Feet', true),
  ('Perimeter in yards', '2*(Width_in_yards+Height_in_yards)', 'Yard', true),
  ('Height', 'Height', 'Feet', true),
  ('Height in yards', 'Height_in_yards', 'Yard', true),
  ('Width', 'Width', 'Feet', true),
  ('Width in yards', 'Width_in_yards', 'Yard', true),
  ('Length in yards', 'Length_in_yards', 'Yard', true),
  ('Volume', 'Width*Height*Depth', 'CuFt', true),
  ('CylVol', '3.14*Radius*Radius*Height', 'CuFt', true),
  ('Cylindrical Surface Area', '2*3.14159*(Diameter/2)*(Diameter/2)+2*3.14159*(Diameter/2)*Height', 'Sqft', true),
  ('Cylindrical Surface Area in sqyd', '2*3.14159*(Diameter_in_yards/2)*(Diameter_in_yards/2)+2*3.14159*(Diameter_in_yards/2)*Height_in_yards', 'SqYd', true),
  ('Board Feet', '(Width_in_feet*Height*Length_in_feet)/12', 'CuFt', true),
  ('Total Area', 'Total_Area', 'Sqft', true)
ON CONFLICT DO NOTHING;

SELECT 'Migration 010 complete - 22 tables created successfully' as result;

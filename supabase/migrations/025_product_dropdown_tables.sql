-- Ensure product_dropdown_menus and product_dropdown_items exist.
-- Already created by 010_product_builder_FIXED.sql but may not be applied.

CREATE TABLE IF NOT EXISTS product_dropdown_menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  menu_name text NOT NULL,
  sort_order integer DEFAULT 0,
  is_optional boolean DEFAULT true,
  include_in_base_price boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_dropdown_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  dropdown_menu_id uuid REFERENCES product_dropdown_menus(id) ON DELETE CASCADE,
  item_type text CHECK (item_type IN ('Material', 'LaborRate', 'MachineRate')),
  material_id uuid,
  labor_rate_id uuid,
  machine_rate_id uuid,
  item_kind text DEFAULT 'Company Items',
  system_formula text DEFAULT 'Area',
  charge_per_li_unit boolean DEFAULT false,
  include_in_base_price boolean DEFAULT false,
  multiplier numeric(8,4) DEFAULT 1.0,
  fixed_quantity numeric(10,4),
  percentage_of_base numeric(8,4),
  is_optional boolean DEFAULT true,
  reference_tag text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Add include_in_base_price to menus if missing
ALTER TABLE product_dropdown_menus ADD COLUMN IF NOT EXISTS include_in_base_price boolean DEFAULT false;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dropdown_menus_product ON product_dropdown_menus(product_id);
CREATE INDEX IF NOT EXISTS idx_dropdown_items_menu ON product_dropdown_items(dropdown_menu_id);

// src/types/product-builder.ts
// Generated from migration 010 — April 6 2026

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type PricingType = 'Formula' | 'Basic' | 'Grid' | 'Cost Plus'
export type ProductStatus = 'draft' | 'published' | 'disabled' | 'archived'
export type ModifierType = 'Boolean' | 'Numeric' | 'Range'
export type DiscountType = 'Range' | 'Volume' | 'Price'
export type DiscountAppliesTo = 'Product' | 'Material' | 'Both'
export type DiscountBy = 'Percentage' | 'Fixed Price'
export type ItemType = 'Material' | 'LaborRate' | 'MachineRate' | 'CustomItem'
export type DropdownItemType = 'Material' | 'LaborRate' | 'MachineRate'
export type CustomFieldType = 'text' | 'textarea' | 'radio' | 'color' | 'dropdown'

export interface PricingFormula {
  id: string; organization_id: string | null; name: string; formula: string
  uom: string; description: string | null; sort_order: number | null; active: boolean | null
  is_system: boolean; created_at: string; updated_at: string
}

export interface MaterialType {
  id: string; organization_id: string | null; name: string
  created_at: string; created_by: string | null; updated_at: string
}

export interface MaterialCategory {
  id: string; organization_id: string | null; name: string
  material_type_id: string | null; created_at: string; updated_at: string
}

export interface ProductCategory {
  id: string; organization_id: string | null; name: string
  secondary_category: string | null; created_at: string; updated_at: string
}

export interface Department {
  id: string; organization_id: string | null; name: string
  created_at: string; updated_at: string
}

export interface LaborRate {
  id: string; organization_id: string | null; name: string; external_name: string | null
  cost: number; price: number; markup: number
  setup_charge: number | null; machine_charge: number | null; other_charge: number | null
  formula: string | null; units: string | null
  include_in_base_price: boolean | null; per_li_unit: boolean | null
  production_rate: number | null; production_rate_units: string | null
  production_rate_per: string | null; production_factor: number | null
  production_rate_prompt: string | null; production_rate_prompt_detail: string | null
  volume_discount_id: string | null; cog_account: string | null
  cog_account_number: string | null; qb_item_type: string | null
  description: string | null; display_name_in_line_item: boolean | null
  display_description_in_line_item: boolean | null; show_internal: boolean | null
  sop_url: string | null; video_url: string | null; used_in_products: Json
  department_id: string | null; cloned_from_machine_rate_id: string | null
  profit_margin_pct: number | null; active: boolean | null
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null
}

export interface MachineRate {
  id: string; organization_id: string | null; name: string; external_name: string | null
  cost: number; price: number; markup: number
  setup_charge: number | null; other_charge: number | null; labor_charge: number | null
  formula: string | null; units: string | null
  include_in_base_price: boolean | null; per_li_unit: boolean | null
  production_rate: number | null; production_rate_units: string | null; production_rate_per: string | null
  equipment_replacement_value: number | null; equipment_useful_life_years: number | null
  markup_for_replacement: number | null; monthly_operating_hours: number | null
  monthly_maintenance_cost: number | null; monthly_lease_payment: number | null
  replacement_reserve_per_hr: number | null; operating_cost_per_hr: number | null
  volume_discount_id: string | null; cog_account: string | null
  cog_account_number: string | null; qb_item_type: string | null
  description: string | null; display_name_in_line_item: boolean | null
  display_description_in_line_item: boolean | null; show_internal: boolean | null
  sop_url: string | null; video_url: string | null
  department_id: string | null; cloned_from_labor_rate_id: string | null
  profit_margin_pct: number | null; active: boolean | null
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null
}

export interface Material {
  id: string; organization_id: string | null; name: string; external_name: string | null
  description: string | null; po_description: string | null
  material_type_id: string | null; category_id: string | null
  cost: number; price: number; multiplier: number | null
  buying_units: string | null; selling_units: string | null; sell_buy_ratio: number | null
  conversion_factor: number | null; per_li_unit: string | null
  width: number | null; height: number | null; fixed_side: string | null
  fixed_quantity: number | null; sheet_cost: number | null
  wastage_markup: number | null; calculate_wastage: boolean | null; allow_variants: boolean | null
  labor_charge: number | null; machine_charge: number | null
  other_charge: number | null; setup_charge: number | null
  formula: string | null; discount_id: string | null; discount: string | null
  track_inventory: boolean | null; in_use: boolean | null
  weight: number | null; weight_uom: string | null
  cog_account_name: string | null; cog_account_number: number | null; qb_item_type: string | null
  preferred_vendor: string | null; part_number: string | null; sku: string | null
  display_name_in_line_item: string | null; show_internal: boolean | null
  show_external: boolean | null; print_image_on_pdf: boolean | null
  info_url: string | null; image_url: string | null
  include_in_base_price: boolean | null; percentage_of_base: number | null
  remnant_width: number | null; remnant_length: number | null
  remnant_location: string | null; remnant_usable: boolean | null
  last_price_update: string | null; price_change_alert_threshold: number | null
  active: boolean | null
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null
}

export interface MaterialVendor {
  id: string; organization_id: string | null; material_id: string | null
  vendor_name: string; vendor_price: number; rank: number | null
  buying_units: string | null; length_per_unit: number | null
  part_name: string | null; part_number: string | null; delivery_fee: number | null
  min_stock_level: number | null; max_stock_level: number | null; min_order_value: number | null
  last_price_date: string | null; previous_price: number | null; active: boolean | null
  created_at: string; updated_at: string
}

export interface Modifier {
  id: string; organization_id: string | null; name: string; display_name: string
  system_lookup_name: string | null; modifier_type: ModifierType; units: string | null
  range_min_label: string | null; range_max_label: string | null
  range_min_value: number | null; range_max_value: number | null
  range_default_value: number | null; range_step_interval: number | null
  show_internally: boolean | null; show_customer: boolean | null
  is_system_variable: boolean | null; active: boolean | null
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null
}

export interface Discount {
  id: string; organization_id: string | null; name: string
  discount_type: DiscountType; applies_to: DiscountAppliesTo; discount_by: DiscountBy
  active: boolean | null
  created_at: string; created_by: string | null; updated_at: string
}

export interface DiscountTier {
  id: string; discount_id: string | null; min_qty: number; max_qty: number | null
  discount_percent: number | null; fixed_price: number | null; sort_order: number | null
}

export interface WorkflowTemplate {
  id: string; organization_id: string | null; name: string; description: string | null
  template_type: string | null; active: boolean | null
  created_at: string; created_by: string | null; updated_at: string
}

export interface WorkflowStage {
  id: string; organization_id: string | null; workflow_template_id: string | null
  name: string; description: string | null; sort_order: number | null
  department_id: string | null; estimated_time_minutes: number | null; time_formula: string | null
  machine_rate_id: string | null; labor_rate_id: string | null; stage_phase: string | null
  requires_proof: boolean | null; requires_customer_approval: boolean | null; requires_qc: boolean | null
  can_track_time: boolean | null; api_auto_advance: boolean | null
  qr_scan_advance: boolean | null; voice_command_advance: boolean | null
  created_at: string; updated_at: string
}

export interface Product {
  id: string; organization_id: string | null; name: string; description: string | null
  part_number: string | null; sku: number | null; upc: number | null
  category_id: string | null; secondary_category: string | null; product_type: string | null
  pricing_type: PricingType | null; pricing_method: string | null
  formula: string | null; show_feet_inches: boolean | null
  cost: number | null; buying_cost: number | null; price: number | null; markup: number | null
  buying_units: string | null; units: string | null; conversion_factor: number | null
  min_line_price: number | null; min_unit_price: number | null
  volume_discount_id: string | null; range_discount_id: string | null
  workflow_template_id: string | null
  income_account: string | null; income_account_number: string | null
  cog_account: string | null; cog_account_number: number | null
  asset_account: string | null; asset_account_number: number | null
  qb_item_type: string | null; default_sale_type: string | null
  taxable: boolean | null; in_house_commission: boolean | null
  outsourced_commission: boolean | null; track_inventory: boolean | null
  include_base_product_in_po: boolean | null; print_image_on_pdf: boolean | null
  image_url: string | null; production_details: string | null
  published: boolean | null; published_at: string | null; published_by: string | null
  pricing_template_id: string | null
  complexity_value: number | null  // 1-5
  status: ProductStatus | null; active: boolean | null; rounding: number | null; tax: number | null
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null
}

export interface ProductDefaultItem {
  id: string; organization_id: string | null; product_id: string | null
  item_type: ItemType; material_id: string | null; labor_rate_id: string | null
  machine_rate_id: string | null; custom_item_name: string | null
  custom_item_cost: number | null; custom_item_price: number | null
  menu_name: string | null; system_formula: string | null; item_kind: string | null
  charge_per_li_unit: boolean | null; include_in_base_price: boolean | null
  multiplier: number | null; fixed_quantity: number | null; percentage_of_base: number | null
  is_optional: boolean | null; is_required: boolean | null; sort_order: number | null
  overrides_material_category_id: string | null
  workflow_step: boolean | null; modifier_formula: string | null
  wastage_percent: number | null; item_markup: number | null
  created_at: string; updated_at: string
}

export interface ProductModifier {
  id: string; organization_id: string | null; product_id: string | null
  modifier_id: string | null; sort_order: number | null; is_required: boolean | null
  default_value: string | null; linked_dropdown_item_id: string | null; created_at: string
}

export interface ProductDropdownMenu {
  id: string; organization_id: string | null; product_id: string | null
  menu_name: string; sort_order: number | null; is_optional: boolean | null
  created_at: string; updated_at: string
}

export interface ProductDropdownItem {
  id: string; organization_id: string | null; dropdown_menu_id: string | null
  item_type: DropdownItemType | null; material_id: string | null
  labor_rate_id: string | null; machine_rate_id: string | null
  item_kind: string | null; system_formula: string | null
  charge_per_li_unit: boolean | null; include_in_base_price: boolean | null
  multiplier: number | null; fixed_quantity: number | null
  percentage_of_base: number | null; is_optional: boolean | null
  reference_tag: string | null; sort_order: number | null; created_at: string
}

export interface ProductCustomField {
  id: string; organization_id: string | null; product_id: string | null
  field_name: string; field_type: CustomFieldType | null; field_group: string | null
  placeholder: string | null; default_value: string | null
  is_required: boolean | null; print_on_customer_pdf: boolean | null
  print_on_po: boolean | null; sort_order: number | null; created_at: string
}

export interface MaterialPricingLevel {
  id: string; organization_id: string | null; name: string; description: string | null
  discount_percent: number | null; active: boolean | null; created_at: string
}

// Insert types
export type LaborRateInsert = Omit<LaborRate, 'id' | 'created_at' | 'updated_at'>
export type MachineRateInsert = Omit<MachineRate, 'id' | 'created_at' | 'updated_at'>
export type MaterialInsert = Omit<Material, 'id' | 'created_at' | 'updated_at'>
export type MaterialVendorInsert = Omit<MaterialVendor, 'id' | 'created_at' | 'updated_at'>
export type ModifierInsert = Omit<Modifier, 'id' | 'created_at' | 'updated_at'>
export type DiscountInsert = Omit<Discount, 'id' | 'created_at' | 'updated_at'>
export type DiscountTierInsert = Omit<DiscountTier, 'id'>
export type ProductInsert = Omit<Product, 'id' | 'created_at' | 'updated_at'>
export type ProductDefaultItemInsert = Omit<ProductDefaultItem, 'id' | 'created_at' | 'updated_at'>

// Update types
export type LaborRateUpdate = Partial<LaborRateInsert>
export type MachineRateUpdate = Partial<MachineRateInsert>
export type MaterialUpdate = Partial<MaterialInsert>
export type ModifierUpdate = Partial<ModifierInsert>
export type DiscountUpdate = Partial<DiscountInsert>
export type ProductUpdate = Partial<ProductInsert>

// Joined types for queries with relations
export interface ProductWithRelations extends Product {
  category?: ProductCategory | null
  workflow_template?: WorkflowTemplate | null
  volume_discount?: Discount | null
  range_discount?: Discount | null
  default_items?: (ProductDefaultItem & {
    material?: Material | null
    labor_rate?: LaborRate | null
    machine_rate?: MachineRate | null
  })[]
  modifiers?: (ProductModifier & { modifier?: Modifier | null })[]
  dropdown_menus?: (ProductDropdownMenu & { items?: ProductDropdownItem[] })[]
  custom_fields?: ProductCustomField[]
}

export interface MaterialWithRelations extends Material {
  material_type?: MaterialType | null
  category?: MaterialCategory | null
  vendors?: MaterialVendor[]
}

export interface DiscountWithTiers extends Discount {
  tiers?: DiscountTier[]
}

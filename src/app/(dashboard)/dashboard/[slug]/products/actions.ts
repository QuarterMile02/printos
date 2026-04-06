'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { OrgRole } from '@/types/database'
import type { ProductStatus } from '@/types/product-builder'

// Tabs 1 + 2 + 3 wired up. Tab 4 will extend this type.
export type ProductFormData = {
  // Tab 1 — Basic Settings
  name: string
  description: string | null
  product_type: string | null
  category_id: string | null
  secondary_category: string | null
  workflow_template_id: string | null
  complexity_value: number | null
  image_url: string | null
  status: ProductStatus
  // Tab 2 — Advanced Settings
  income_account: string | null
  income_account_number: string | null
  cog_account: string | null
  cog_account_number: number | null
  asset_account: string | null
  default_sale_type: string | null
  qb_item_type: string | null
  rounding: number | null
  taxable: boolean
  in_house_commission: boolean
  outsourced_commission: boolean
  include_base_product_in_po: boolean
  print_image_on_pdf: boolean
  production_details: string | null
  // Tab 3 — Configure Pricing
  pricing_type: 'Formula' | 'Basic' | 'Grid' | null
  pricing_method: string | null
  formula: string | null
  show_feet_inches: boolean
  buying_cost: number | null
  buying_units: string | null
  conversion_factor: number | null
  units: string | null
  cost: number
  markup: number
  price: number
  min_line_price: number | null
  min_unit_price: number | null
  volume_discount_id: string | null
  range_discount_id: string | null
}

// Sub-tab data carried separately from the main product record
export type DefaultItemInput = {
  item_type: 'Material' | 'LaborRate' | 'MachineRate' | 'CustomItem'
  material_id: string | null
  labor_rate_id: string | null
  machine_rate_id: string | null
  custom_item_name: string | null
  menu_name: string | null
  system_formula: string | null
  charge_per_li_unit: boolean
  include_in_base_price: boolean
  is_optional: boolean
  multiplier: number | null
}

export type ProductModifierInput = {
  modifier_id: string
  is_required: boolean
  default_value: string | null
}

export type DropdownMenuInput = {
  menu_name: string
  is_optional: boolean
  items: DropdownItemInput[]
}

export type DropdownItemInput = {
  item_type: 'Material' | 'LaborRate' | 'MachineRate'
  material_id: string | null
  labor_rate_id: string | null
  machine_rate_id: string | null
  system_formula: string | null
  charge_per_li_unit: boolean
  is_optional: boolean
}

export type CustomFieldType = 'text' | 'textarea' | 'radio' | 'color' | 'dropdown'

export type ProductCustomFieldInput = {
  field_name: string
  field_type: CustomFieldType
  is_required: boolean
  print_on_customer_pdf: boolean
  print_on_po: boolean
}

export type ProductSaveBundle = {
  product: ProductFormData
  defaultItems: DefaultItemInput[]
  modifiers: ProductModifierInput[]
  dropdownMenus: DropdownMenuInput[]
  customFields: ProductCustomFieldInput[]
}

async function getMembership(orgId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, membership: null }
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }
  return { user, membership }
}

function buildRecord(data: ProductFormData) {
  return {
    // Tab 1
    name: data.name.trim(),
    description: data.description?.trim() || null,
    product_type: data.product_type?.trim() || null,
    category_id: data.category_id,
    secondary_category: data.secondary_category?.trim() || null,
    workflow_template_id: data.workflow_template_id,
    complexity_value: data.complexity_value,
    image_url: data.image_url?.trim() || null,
    status: data.status,
    active: data.status === 'published',
    // Tab 2
    income_account: data.income_account?.trim() || null,
    income_account_number: data.income_account_number?.trim() || null,
    cog_account: data.cog_account?.trim() || null,
    cog_account_number: data.cog_account_number,
    asset_account: data.asset_account?.trim() || null,
    default_sale_type: data.default_sale_type,
    qb_item_type: data.qb_item_type,
    rounding: data.rounding,
    taxable: data.taxable,
    in_house_commission: data.in_house_commission,
    outsourced_commission: data.outsourced_commission,
    include_base_product_in_po: data.include_base_product_in_po,
    print_image_on_pdf: data.print_image_on_pdf,
    production_details: data.production_details?.trim() || null,
    // Tab 3 — Pricing
    pricing_type: data.pricing_type,
    pricing_method: data.pricing_method,
    formula: data.formula,
    show_feet_inches: data.show_feet_inches,
    buying_cost: data.buying_cost,
    buying_units: data.buying_units,
    conversion_factor: data.conversion_factor,
    units: data.units,
    cost: data.cost,
    markup: data.markup,
    price: data.price,
    min_line_price: data.min_line_price,
    min_unit_price: data.min_unit_price,
    volume_discount_id: data.volume_discount_id,
    range_discount_id: data.range_discount_id,
  }
}

// ---- Relation save helpers ----

async function replaceDefaultItems(productId: string, orgId: string, items: DefaultItemInput[]) {
  const service = createServiceClient()
  await service.from('product_default_items').delete().eq('product_id', productId).eq('organization_id', orgId)

  if (items.length > 0) {
    const rows = items.map((item, i) => ({
      organization_id: orgId,
      product_id: productId,
      item_type: item.item_type,
      material_id: item.material_id,
      labor_rate_id: item.labor_rate_id,
      machine_rate_id: item.machine_rate_id,
      custom_item_name: item.custom_item_name,
      menu_name: item.menu_name,
      system_formula: item.system_formula,
      charge_per_li_unit: item.charge_per_li_unit,
      include_in_base_price: item.include_in_base_price,
      is_optional: item.is_optional,
      multiplier: item.multiplier,
      sort_order: i,
    }))
    await service.from('product_default_items').insert(rows)
  }
}

async function replaceProductModifiers(productId: string, orgId: string, modifiers: ProductModifierInput[]) {
  const service = createServiceClient()
  await service.from('product_modifiers').delete().eq('product_id', productId).eq('organization_id', orgId)

  if (modifiers.length > 0) {
    const rows = modifiers.map((m, i) => ({
      organization_id: orgId,
      product_id: productId,
      modifier_id: m.modifier_id,
      is_required: m.is_required,
      default_value: m.default_value,
      sort_order: i,
    }))
    await service.from('product_modifiers').insert(rows)
  }
}

async function replaceProductCustomFields(
  productId: string,
  orgId: string,
  fields: ProductCustomFieldInput[],
) {
  const service = createServiceClient()
  await service.from('product_custom_fields').delete().eq('product_id', productId).eq('organization_id', orgId)

  if (fields.length > 0) {
    const rows = fields
      .filter((f) => f.field_name.trim())
      .map((f, i) => ({
        organization_id: orgId,
        product_id: productId,
        field_name: f.field_name.trim(),
        field_type: f.field_type,
        is_required: f.is_required,
        print_on_customer_pdf: f.print_on_customer_pdf,
        print_on_po: f.print_on_po,
        sort_order: i,
      }))
    if (rows.length > 0) {
      await service.from('product_custom_fields').insert(rows)
    }
  }
}

async function replaceDropdownMenus(productId: string, orgId: string, menus: DropdownMenuInput[]) {
  const service = createServiceClient()

  // Get existing menus to delete their items first (cascade would handle this but explicit is clearer)
  const { data: existingMenus } = await service
    .from('product_dropdown_menus')
    .select('id')
    .eq('product_id', productId)
    .eq('organization_id', orgId)

  const existingIds = (existingMenus ?? []).map((m) => m.id)
  if (existingIds.length > 0) {
    await service.from('product_dropdown_items').delete().in('dropdown_menu_id', existingIds)
    await service.from('product_dropdown_menus').delete().in('id', existingIds)
  }

  // Insert new menus + their items
  for (let i = 0; i < menus.length; i++) {
    const menu = menus[i]
    if (!menu.menu_name.trim()) continue
    const { data: insertedMenu } = await service
      .from('product_dropdown_menus')
      .insert({
        organization_id: orgId,
        product_id: productId,
        menu_name: menu.menu_name.trim(),
        is_optional: menu.is_optional,
        sort_order: i,
      })
      .select('id')
      .single() as { data: { id: string } | null; error: unknown }

    if (!insertedMenu) continue

    if (menu.items.length > 0) {
      const itemRows = menu.items.map((item, j) => ({
        organization_id: orgId,
        dropdown_menu_id: insertedMenu.id,
        item_type: item.item_type,
        material_id: item.material_id,
        labor_rate_id: item.labor_rate_id,
        machine_rate_id: item.machine_rate_id,
        system_formula: item.system_formula,
        charge_per_li_unit: item.charge_per_li_unit,
        is_optional: item.is_optional,
        sort_order: j,
      }))
      await service.from('product_dropdown_items').insert(itemRows)
    }
  }
}

export async function createProduct(
  orgId: string,
  orgSlug: string,
  bundle: ProductSaveBundle
): Promise<{ error?: string; id?: string }> {
  if (!bundle.product.name.trim()) return { error: 'Name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create products.' }

  const service = createServiceClient()
  const { data: inserted, error } = await service
    .from('products')
    .insert({
      organization_id: orgId,
      ...buildRecord(bundle.product),
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single()

  if (error || !inserted) return { error: error?.message ?? 'Failed to create product.' }

  await replaceDefaultItems(inserted.id, orgId, bundle.defaultItems)
  await replaceProductModifiers(inserted.id, orgId, bundle.modifiers)
  await replaceDropdownMenus(inserted.id, orgId, bundle.dropdownMenus)
  await replaceProductCustomFields(inserted.id, orgId, bundle.customFields)

  revalidatePath(`/dashboard/${orgSlug}/products`)
  return { id: inserted.id }
}

export async function updateProduct(
  id: string,
  orgId: string,
  orgSlug: string,
  bundle: ProductSaveBundle
): Promise<{ error?: string }> {
  if (!bundle.product.name.trim()) return { error: 'Name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update products.' }

  const service = createServiceClient()
  const { error } = await service
    .from('products')
    .update({ ...buildRecord(bundle.product), updated_by: user.id })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  await replaceDefaultItems(id, orgId, bundle.defaultItems)
  await replaceProductModifiers(id, orgId, bundle.modifiers)
  await replaceDropdownMenus(id, orgId, bundle.dropdownMenus)
  await replaceProductCustomFields(id, orgId, bundle.customFields)

  revalidatePath(`/dashboard/${orgSlug}/products`)
  revalidatePath(`/dashboard/${orgSlug}/products/${id}`)
  return {}
}

export async function createProductAndRedirect(
  orgId: string,
  orgSlug: string,
  bundle: ProductSaveBundle
) {
  const result = await createProduct(orgId, orgSlug, bundle)
  if (result.error) return result
  if (result.id) {
    redirect(`/dashboard/${orgSlug}/products/${result.id}`)
  }
  return result
}

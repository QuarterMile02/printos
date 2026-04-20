'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'

export type MigrateDefaultItem = {
  item_type: 'Material' | 'LaborRate' | 'MachineRate' | 'CustomItem'
  material_id: string | null
  labor_rate_id: string | null
  machine_rate_id: string | null
  custom_item_name: string | null
  system_formula: string | null
  multiplier: number | null
  charge_per_li_unit: boolean
  include_in_base_price: boolean
  menu_name: string | null
  is_optional: boolean
  workflow_step: boolean
  modifier_formula: string | null
  wastage_percent: number | null
  item_markup: number | null
  overrides_material_category_id: string | null
}

export type MigrateOptionRate = {
  rate_type: 'labor_rate' | 'machine_rate'
  rate_id: string
  category: string | null
  formula: string | null
  multiplier: number
  charge_per_li_unit: boolean
  modifier_formula: string | null
  workflow_step: boolean
}

export type MigrateModifier = {
  modifier_id: string
  is_required: boolean
  default_value: string | null
}

export type MigrateDropdownItem = {
  item_type: 'Material' | 'LaborRate' | 'MachineRate'
  material_id: string | null
  labor_rate_id: string | null
  machine_rate_id: string | null
  system_formula: string | null
  charge_per_li_unit: boolean
  is_optional: boolean
}

export type MigrateDropdownMenu = {
  menu_name: string
  is_optional: boolean
  items: MigrateDropdownItem[]
}

export type MigrateBasic = {
  name: string
  description: string | null
  product_type: string | null
  category_id: string | null
  secondary_category: string | null
  workflow_template_id: string | null
}

export type MigratePricing = {
  pricing_type: 'Formula' | 'Basic' | 'Grid' | 'Cost Plus' | null
  pricing_method: string | null
  formula: string | null
  buying_units: string | null
  range_discount_id: string | null
}

export type MigrateBundle = {
  basic: MigrateBasic
  pricing: MigratePricing
  defaultItems: MigrateDefaultItem[]
  optionRates: MigrateOptionRate[]
  modifiers: MigrateModifier[]
  dropdownMenus: MigrateDropdownMenu[]
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

function canEdit(role: OrgRole | undefined | null) {
  return role && role !== 'viewer'
}

async function replaceDefaultItems(productId: string, orgId: string, items: MigrateDefaultItem[]) {
  const service = createServiceClient()
  await service.from('product_default_items').delete().eq('product_id', productId).eq('organization_id', orgId)
  if (items.length === 0) return
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
    workflow_step: item.workflow_step,
    modifier_formula: item.modifier_formula,
    wastage_percent: item.wastage_percent,
    item_markup: item.item_markup,
    overrides_material_category_id: item.overrides_material_category_id,
    sort_order: i,
  }))
  await service.from('product_default_items').insert(rows)
}

async function replaceOptionRates(productId: string, rates: MigrateOptionRate[]) {
  const service = createServiceClient()
  await service.from('product_option_rates').delete().eq('product_id', productId)
  if (rates.length === 0) return
  const rows = rates.map((r, i) => ({
    product_id: productId,
    rate_type: r.rate_type,
    rate_id: r.rate_id,
    category: r.category,
    formula: r.formula,
    multiplier: r.multiplier,
    charge_per_li_unit: r.charge_per_li_unit,
    modifier_formula: r.modifier_formula,
    workflow_step: r.workflow_step,
    sort_order: i,
  }))
  await service.from('product_option_rates').insert(rows)
}

async function replaceProductModifiers(productId: string, orgId: string, modifiers: MigrateModifier[]) {
  const service = createServiceClient()
  await service.from('product_modifiers').delete().eq('product_id', productId).eq('organization_id', orgId)
  if (modifiers.length === 0) return
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

async function replaceDropdownMenus(productId: string, orgId: string, menus: MigrateDropdownMenu[]) {
  const service = createServiceClient()
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

export async function saveMigrationDraft(
  productId: string,
  orgId: string,
  orgSlug: string,
  bundle: MigrateBundle,
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!canEdit(membership?.role)) return { error: 'You do not have permission to edit this product.' }

  const service = createServiceClient()
  const { error } = await service
    .from('products')
    .update({
      name: bundle.basic.name.trim(),
      description: bundle.basic.description?.trim() || null,
      product_type: bundle.basic.product_type?.trim() || null,
      category_id: bundle.basic.category_id,
      secondary_category: bundle.basic.secondary_category?.trim() || null,
      workflow_template_id: bundle.basic.workflow_template_id,
      pricing_type: bundle.pricing.pricing_type,
      pricing_method: bundle.pricing.pricing_method,
      formula: bundle.pricing.formula,
      buying_units: bundle.pricing.buying_units,
      range_discount_id: bundle.pricing.range_discount_id,
      migration_status: 'in_progress',
      updated_by: user.id,
    })
    .eq('id', productId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  await replaceDefaultItems(productId, orgId, bundle.defaultItems)
  await replaceOptionRates(productId, bundle.optionRates)
  await replaceProductModifiers(productId, orgId, bundle.modifiers)
  await replaceDropdownMenus(productId, orgId, bundle.dropdownMenus)

  revalidatePath(`/dashboard/${orgSlug}/products`)
  revalidatePath(`/dashboard/${orgSlug}/products/${productId}`)
  revalidatePath(`/dashboard/${orgSlug}/products/${productId}/migrate`)
  return {}
}

export async function publishMigration(
  productId: string,
  orgId: string,
  orgSlug: string,
  bundle: MigrateBundle,
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!canEdit(membership?.role)) return { error: 'You do not have permission to publish this product.' }

  if (!bundle.basic.name.trim()) return { error: 'Name is required to publish.' }

  const service = createServiceClient()
  const { error } = await service
    .from('products')
    .update({
      name: bundle.basic.name.trim(),
      description: bundle.basic.description?.trim() || null,
      product_type: bundle.basic.product_type?.trim() || null,
      category_id: bundle.basic.category_id,
      secondary_category: bundle.basic.secondary_category?.trim() || null,
      workflow_template_id: bundle.basic.workflow_template_id,
      pricing_type: bundle.pricing.pricing_type,
      pricing_method: bundle.pricing.pricing_method,
      formula: bundle.pricing.formula,
      buying_units: bundle.pricing.buying_units,
      range_discount_id: bundle.pricing.range_discount_id,
      status: 'published',
      active: true,
      published: true,
      published_at: new Date().toISOString(),
      published_by: user.id,
      migration_status: 'printos_ready',
      updated_by: user.id,
    })
    .eq('id', productId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  await replaceDefaultItems(productId, orgId, bundle.defaultItems)
  await replaceOptionRates(productId, bundle.optionRates)
  await replaceProductModifiers(productId, orgId, bundle.modifiers)
  await replaceDropdownMenus(productId, orgId, bundle.dropdownMenus)

  revalidatePath(`/dashboard/${orgSlug}/products`)
  revalidatePath(`/dashboard/${orgSlug}/products/${productId}`)
  revalidatePath(`/dashboard/${orgSlug}/products/${productId}/migrate`)
  return {}
}

// ---- Inline "Add New" creators ---------------------------------------------

export async function createMaterialCategory(
  orgId: string,
  name: string,
): Promise<{ error?: string; row?: { id: string; name: string } }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!canEdit(membership?.role)) return { error: 'No permission.' }
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name is required.' }
  const service = createServiceClient()
  const { data, error } = await service
    .from('material_categories')
    .insert({ organization_id: orgId, name: trimmed })
    .select('id, name')
    .single() as { data: { id: string; name: string } | null; error: { message: string } | null }
  if (error || !data) return { error: error?.message ?? 'Failed to create category.' }
  return { row: data }
}

export async function createLaborRate(
  orgId: string,
  input: { name: string; category: string | null; cost: number; markup: number },
): Promise<{ error?: string; row?: { id: string; name: string; category: string | null; cost: number; markup: number } }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!canEdit(membership?.role)) return { error: 'No permission.' }
  const trimmed = input.name.trim()
  if (!trimmed) return { error: 'Name is required.' }
  const service = createServiceClient()
  const { data, error } = await service
    .from('labor_rates')
    .insert({
      organization_id: orgId,
      name: trimmed,
      category: input.category?.trim() || null,
      cost: input.cost,
      price: input.cost * input.markup,
      markup: input.markup,
      active: true,
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id, name, category, cost, markup')
    .single() as { data: { id: string; name: string; category: string | null; cost: number; markup: number } | null; error: { message: string } | null }
  if (error || !data) return { error: error?.message ?? 'Failed to create labor rate.' }
  return { row: data }
}

export async function createMachineRate(
  orgId: string,
  input: { name: string; category: string | null; cost: number; markup: number },
): Promise<{ error?: string; row?: { id: string; name: string; category: string | null; cost: number; markup: number } }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!canEdit(membership?.role)) return { error: 'No permission.' }
  const trimmed = input.name.trim()
  if (!trimmed) return { error: 'Name is required.' }
  const service = createServiceClient()
  const { data, error } = await service
    .from('machine_rates')
    .insert({
      organization_id: orgId,
      name: trimmed,
      category: input.category?.trim() || null,
      cost: input.cost,
      price: input.cost * input.markup,
      markup: input.markup,
      active: true,
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id, name, category, cost, markup')
    .single() as { data: { id: string; name: string; category: string | null; cost: number; markup: number } | null; error: { message: string } | null }
  if (error || !data) return { error: error?.message ?? 'Failed to create machine rate.' }
  return { row: data }
}

export async function createModifier(
  orgId: string,
  input: { name: string; modifier_type: 'Boolean' | 'Numeric' | 'Range'; default_value: string | null },
): Promise<{ error?: string; row?: { id: string; name: string; display_name: string; modifier_type: string } }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!canEdit(membership?.role)) return { error: 'No permission.' }
  const trimmed = input.name.trim()
  if (!trimmed) return { error: 'Name is required.' }
  const service = createServiceClient()
  const rangeDefault = input.modifier_type === 'Range' && input.default_value ? Number(input.default_value) : null
  const { data, error } = await service
    .from('modifiers')
    .insert({
      organization_id: orgId,
      name: trimmed,
      display_name: trimmed,
      system_lookup_name: trimmed.replace(/\s+/g, '_'),
      modifier_type: input.modifier_type,
      range_default_value: rangeDefault,
      active: true,
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id, name, display_name, modifier_type')
    .single() as { data: { id: string; name: string; display_name: string; modifier_type: string } | null; error: { message: string } | null }
  if (error || !data) return { error: error?.message ?? 'Failed to create modifier.' }
  return { row: data }
}

export async function createDiscount(
  orgId: string,
  input: { name: string; discount_type: 'Range' | 'Volume' | 'Price' },
): Promise<{ error?: string; row?: { id: string; name: string; discount_type: string } }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!canEdit(membership?.role)) return { error: 'No permission.' }
  const trimmed = input.name.trim()
  if (!trimmed) return { error: 'Name is required.' }
  const service = createServiceClient()
  const { data, error } = await service
    .from('discounts')
    .insert({
      organization_id: orgId,
      name: trimmed,
      discount_type: input.discount_type,
      applies_to: 'Product',
      discount_by: 'Percentage',
      active: true,
      created_by: user.id,
    })
    .select('id, name, discount_type')
    .single() as { data: { id: string; name: string; discount_type: string } | null; error: { message: string } | null }
  if (error || !data) return { error: error?.message ?? 'Failed to create discount.' }
  return { row: data }
}

export async function createWorkflow(
  orgId: string,
  input: { name: string },
): Promise<{ error?: string; row?: { id: string; name: string } }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!canEdit(membership?.role)) return { error: 'No permission.' }
  const trimmed = input.name.trim()
  if (!trimmed) return { error: 'Name is required.' }
  const service = createServiceClient()
  const { data, error } = await service
    .from('workflow_templates')
    .insert({
      organization_id: orgId,
      name: trimmed,
      active: true,
      created_by: user.id,
    })
    .select('id, name')
    .single() as { data: { id: string; name: string } | null; error: { message: string } | null }
  if (error || !data) return { error: error?.message ?? 'Failed to create workflow.' }
  return { row: data }
}

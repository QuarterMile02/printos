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
  menu_name: string | null // reused here to persist modifier expression
  is_optional: boolean
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
    sort_order: i,
  }))
  await service.from('product_default_items').insert(rows)
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
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot edit products.' }

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
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot publish products.' }

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
  await replaceProductModifiers(productId, orgId, bundle.modifiers)
  await replaceDropdownMenus(productId, orgId, bundle.dropdownMenus)

  revalidatePath(`/dashboard/${orgSlug}/products`)
  revalidatePath(`/dashboard/${orgSlug}/products/${productId}`)
  revalidatePath(`/dashboard/${orgSlug}/products/${productId}/migrate`)
  return {}
}

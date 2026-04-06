'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'

export type MaterialFormData = {
  // Details
  name: string
  external_name: string | null
  material_type_id: string | null
  category_id: string | null
  description: string | null
  po_description: string | null
  info_url: string | null
  image_url: string | null
  show_internal: boolean
  show_external: boolean
  print_image_on_pdf: boolean
  // Pricing
  cost: number
  price: number
  multiplier: number
  selling_units: string | null
  buying_units: string | null
  sell_buy_ratio: number | null
  conversion_factor: number | null
  per_li_unit: string | null
  setup_charge: number | null
  labor_charge: number | null
  machine_charge: number | null
  other_charge: number | null
  formula: string | null
  include_in_base_price: boolean
  percentage_of_base: number | null
  discount_id: string | null
  // Package
  width: number | null
  height: number | null
  fixed_side: string | null
  fixed_quantity: number | null
  sheet_cost: number | null
  weight: number | null
  weight_uom: string | null
  // Wastage
  calculate_wastage: boolean
  wastage_markup: number | null
  allow_variants: boolean
  // Inventory
  track_inventory: boolean
  in_use: boolean
  // Accounting
  cog_account_name: string | null
  cog_account_number: number | null
  qb_item_type: string | null
  // Remnants
  remnant_width: number | null
  remnant_length: number | null
  remnant_location: string | null
  remnant_usable: boolean
  // Status
  active: boolean
}

export type VendorRowInput = {
  vendor_name: string
  vendor_price: number
  rank: number
  buying_units: string | null
  length_per_unit: number | null
  part_name: string | null
  part_number: string | null
  delivery_fee: number | null
  min_stock_level: number | null
  max_stock_level: number | null
  min_order_value: number | null
  active: boolean
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

function buildRecord(data: MaterialFormData) {
  return {
    name: data.name.trim(),
    external_name: data.external_name?.trim() || null,
    material_type_id: data.material_type_id,
    category_id: data.category_id,
    description: data.description,
    po_description: data.po_description,
    info_url: data.info_url,
    image_url: data.image_url,
    show_internal: data.show_internal,
    show_external: data.show_external,
    print_image_on_pdf: data.print_image_on_pdf,
    cost: data.cost,
    price: data.price,
    multiplier: data.multiplier,
    selling_units: data.selling_units,
    buying_units: data.buying_units,
    sell_buy_ratio: data.sell_buy_ratio,
    conversion_factor: data.conversion_factor,
    per_li_unit: data.per_li_unit,
    setup_charge: data.setup_charge,
    labor_charge: data.labor_charge,
    machine_charge: data.machine_charge,
    other_charge: data.other_charge,
    formula: data.formula,
    include_in_base_price: data.include_in_base_price,
    percentage_of_base: data.percentage_of_base,
    discount_id: data.discount_id,
    width: data.width,
    height: data.height,
    fixed_side: data.fixed_side,
    fixed_quantity: data.fixed_quantity,
    sheet_cost: data.sheet_cost,
    weight: data.weight,
    weight_uom: data.weight_uom,
    calculate_wastage: data.calculate_wastage,
    wastage_markup: data.wastage_markup,
    allow_variants: data.allow_variants,
    track_inventory: data.track_inventory,
    in_use: data.in_use,
    cog_account_name: data.cog_account_name,
    cog_account_number: data.cog_account_number,
    qb_item_type: data.qb_item_type,
    remnant_width: data.remnant_width,
    remnant_length: data.remnant_length,
    remnant_location: data.remnant_location,
    remnant_usable: data.remnant_usable,
    active: data.active,
  }
}

async function replaceVendors(materialId: string, orgId: string, vendors: VendorRowInput[]) {
  const service = createServiceClient()

  // Delete existing vendors for this material
  await service
    .from('material_vendors')
    .delete()
    .eq('material_id', materialId)
    .eq('organization_id', orgId)

  // Insert new vendors
  if (vendors.length > 0) {
    const rows = vendors
      .filter((v) => v.vendor_name.trim().length > 0)
      .map((v, i) => ({
        organization_id: orgId,
        material_id: materialId,
        vendor_name: v.vendor_name.trim(),
        vendor_price: v.vendor_price,
        rank: i + 1,
        buying_units: v.buying_units,
        length_per_unit: v.length_per_unit,
        part_name: v.part_name,
        part_number: v.part_number,
        delivery_fee: v.delivery_fee,
        min_stock_level: v.min_stock_level,
        max_stock_level: v.max_stock_level,
        min_order_value: v.min_order_value,
        active: v.active,
      }))
    if (rows.length > 0) {
      await service.from('material_vendors').insert(rows)
    }
  }
}

export async function createMaterial(
  orgId: string,
  orgSlug: string,
  data: MaterialFormData,
  vendors: VendorRowInput[]
): Promise<{ error?: string; id?: string }> {
  if (!data.name.trim()) return { error: 'Name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create materials.' }

  const service = createServiceClient()
  const { data: inserted, error } = await service
    .from('materials')
    .insert({
      organization_id: orgId,
      ...buildRecord(data),
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single()

  if (error || !inserted) return { error: error?.message ?? 'Failed to create material.' }

  await replaceVendors(inserted.id, orgId, vendors)

  revalidatePath(`/dashboard/${orgSlug}/settings/materials`)
  return { id: inserted.id }
}

export async function updateMaterial(
  id: string,
  orgId: string,
  orgSlug: string,
  data: MaterialFormData,
  vendors: VendorRowInput[]
): Promise<{ error?: string }> {
  if (!data.name.trim()) return { error: 'Name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update materials.' }

  const service = createServiceClient()
  const { error } = await service
    .from('materials')
    .update({ ...buildRecord(data), updated_by: user.id })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  await replaceVendors(id, orgId, vendors)

  revalidatePath(`/dashboard/${orgSlug}/settings/materials`)
  return {}
}

export async function toggleMaterialActive(
  id: string,
  orgId: string,
  orgSlug: string,
  active: boolean
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update materials.' }

  const service = createServiceClient()
  const { error } = await service
    .from('materials')
    .update({ active, updated_by: user.id })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/settings/materials`)
  return {}
}

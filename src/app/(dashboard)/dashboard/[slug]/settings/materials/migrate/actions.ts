'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { revalidatePath } from 'next/cache'

export type AcceptVariantInput = {
  height: number | null
  width: number | null
  lengthIncrement: number | null
  isDefault: boolean
  baseCost: number | null
  multiplier: number | null
}

export type AcceptProposalInput = {
  orgId: string
  orgSlug: string
  familyName: string
  materialTypeId: string | null
  categoryId: string | null
  sourceRowIds: string[] // shopvox_materials.id
  variants: AcceptVariantInput[]
  vendorSeed: {
    vendorName: string
    vendorPrice: number | null
    partNumber: string | null
    rank: number | null
  } | null
  // Best-available legacy pricing fields, seeded from the accepted
  // proposal's source rows -- materials.cost/price/sheet_cost/etc. are
  // NOT retired by this build (item 8 only retires unit_cost/labor_
  // charge/machine_charge/setup_charge/other_charge/per_li_unit/
  // include_in_base_price/discount_id/display_description_in_li/
  // material_type/material_category from the FORM -- cost/price/
  // sheet_cost stay live and are still what the existing pricing engine
  // reads). Seeding them here means a migrated material prices
  // correctly today, not just after Build 2's form ships.
  legacyFields: {
    cost: number | null
    price: number | null
    sheetCost: number | null
    multiplier: number | null
    weight: number | null
    partNumber: string | null
    sku: string | null
    poDescription: string | null
    infoUrl: string | null
    description: string | null
  }
}

// Accepts one substrate migrate proposal: creates the real materials
// row, its material_variants, an optional seeded material_vendors row,
// then links every contributing shopvox_materials row to the new
// material. Nothing here runs until this is called -- the proposal
// screen only writes on explicit accept, per instruction.
export async function acceptSubstrateProposal(input: AcceptProposalInput) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to create materials.' }

  if (!input.familyName.trim()) return { error: 'Family name is required.' }
  if (input.variants.length === 0) return { error: 'At least one variant is required.' }
  const defaultCount = input.variants.filter((v) => v.isDefault).length
  if (defaultCount > 1) return { error: 'Only one variant can be marked default.' }

  const sb = createServiceClient()

  const { data: material, error: matErr } = await sb
    .from('materials')
    .insert({
      organization_id: input.orgId,
      name: input.familyName,
      material_type_id: input.materialTypeId,
      category_id: input.categoryId,
      length_uom: 'in',
      active: true,
      cost: input.legacyFields.cost,
      price: input.legacyFields.price,
      sheet_cost: input.legacyFields.sheetCost,
      multiplier: input.legacyFields.multiplier ?? 2,
      weight: input.legacyFields.weight,
      part_number: input.legacyFields.partNumber,
      sku: input.legacyFields.sku,
      po_description: input.legacyFields.poDescription,
      info_url: input.legacyFields.infoUrl,
      description: input.legacyFields.description,
      preferred_vendor: input.vendorSeed?.vendorName ?? null,
      width: input.variants.find((v) => v.isDefault)?.width ?? input.variants[0].width,
      height: input.variants.find((v) => v.isDefault)?.height ?? input.variants[0].height,
    })
    .select('id')
    .maybeSingle()
  if (matErr || !material) return { error: matErr?.message ?? 'Failed to create material.' }

  const variantRows = input.variants.map((v, i) => ({
    material_id: material.id,
    height: v.height,
    width: v.width,
    length_increment: v.lengthIncrement,
    is_default: v.isDefault,
    base_cost: v.baseCost,
    multiplier: v.multiplier ?? 2,
    sort_order: i,
  }))
  const { error: varErr } = await sb.from('material_variants').insert(variantRows)
  if (varErr) return { error: `Material created but variants failed: ${varErr.message}` }

  if (input.vendorSeed) {
    const { error: vendErr } = await sb.from('material_vendors').insert({
      organization_id: input.orgId,
      material_id: material.id,
      vendor_name: input.vendorSeed.vendorName,
      vendor_price: input.vendorSeed.vendorPrice,
      part_number: input.vendorSeed.partNumber,
      rank: input.vendorSeed.rank,
      buying_units: 'Sheet',
      is_preferred: true,
      po_description: input.legacyFields.poDescription,
    })
    if (vendErr) return { error: `Material and variants created but vendor seed failed: ${vendErr.message}` }
  }

  // Link every contributing shopvox_materials row to the new material --
  // each keeps its OWN current source_hash as migrated_source_hash (not
  // a shared value), so a future re-scrape that changes any one of them
  // flips that row (and only that row) to CHANGED.
  const { data: sourceRows } = await sb
    .from('shopvox_materials')
    .select('id, source_hash')
    .in('id', input.sourceRowIds)
  for (const row of sourceRows ?? []) {
    await sb
      .from('shopvox_materials')
      .update({ migrated_to_material_id: material.id, migrated_at: new Date().toISOString(), migrated_source_hash: row.source_hash })
      .eq('id', row.id)
  }

  revalidatePath(`/dashboard/${input.orgSlug}/settings/materials/migrate`)
  revalidatePath(`/dashboard/${input.orgSlug}/settings/materials`)
  return { materialId: material.id }
}

// CHANGED review: applies only the fields Ruben checked ("carry this
// change over") to the already-linked material, then re-syncs
// migrated_source_hash so the row goes back to MIGRATED. Called with an
// empty fieldsToApply to just dismiss/acknowledge a CHANGED row without
// changing anything in PrintOS.
export async function applyChangedFields(input: {
  orgId: string
  orgSlug: string
  shopvoxMaterialId: string
  materialId: string
  fieldsToApply: Record<string, string | number | boolean | null>
}) {
  const { allowed } = await checkPermission(input.orgId, 'materials.edit')
  if (!allowed) return { error: 'Not permitted to edit materials.' }

  const sb = createServiceClient()

  if (Object.keys(input.fieldsToApply).length > 0) {
    const { error: updErr } = await sb
      .from('materials')
      .update(input.fieldsToApply)
      .eq('id', input.materialId)
      .eq('organization_id', input.orgId)
    if (updErr) return { error: updErr.message }
  }

  const { data: row } = await sb.from('shopvox_materials').select('source_hash').eq('id', input.shopvoxMaterialId).maybeSingle()
  if (row) {
    await sb.from('shopvox_materials').update({ migrated_source_hash: row.source_hash }).eq('id', input.shopvoxMaterialId)
  }

  revalidatePath(`/dashboard/${input.orgSlug}/settings/materials/migrate`)
  return { ok: true }
}

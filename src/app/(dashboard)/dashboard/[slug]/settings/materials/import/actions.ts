'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'
import type { MaterialImportRow } from '@/lib/material-import-mapper'

export type ImportBatchResult = {
  imported: number
  skipped: number
  errors: { row: number; name: string; message: string }[]
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

// Resolve a list of type/category names to their FK ids, creating any
// missing rows on the fly. Returns a Map keyed by lower-case name.
async function resolveTypeAndCategoryIds(
  orgId: string,
  typeNames: string[],
  categoryNames: string[],
): Promise<{ typeMap: Map<string, string>; categoryMap: Map<string, string> }> {
  const service = createServiceClient()

  // Material types
  const typeMap = new Map<string, string>()
  const uniqueTypes = Array.from(new Set(typeNames.map((n) => n.trim()).filter(Boolean)))
  if (uniqueTypes.length > 0) {
    const { data: existing } = await service
      .from('material_types')
      .select('id, name')
      .eq('organization_id', orgId) as { data: { id: string; name: string }[] | null }
    const existingByLower = new Map((existing ?? []).map((r) => [r.name.toLowerCase(), r.id]))
    const missing = uniqueTypes.filter((n) => !existingByLower.has(n.toLowerCase()))
    if (missing.length > 0) {
      const { data: inserted } = await service
        .from('material_types')
        .insert(missing.map((name) => ({ organization_id: orgId, name })))
        .select('id, name') as { data: { id: string; name: string }[] | null }
      for (const r of inserted ?? []) existingByLower.set(r.name.toLowerCase(), r.id)
    }
    for (const n of uniqueTypes) {
      const id = existingByLower.get(n.toLowerCase())
      if (id) typeMap.set(n.toLowerCase(), id)
    }
  }

  // Material categories
  const categoryMap = new Map<string, string>()
  const uniqueCats = Array.from(new Set(categoryNames.map((n) => n.trim()).filter(Boolean)))
  if (uniqueCats.length > 0) {
    const { data: existing } = await service
      .from('material_categories')
      .select('id, name')
      .eq('organization_id', orgId) as { data: { id: string; name: string }[] | null }
    const existingByLower = new Map((existing ?? []).map((r) => [r.name.toLowerCase(), r.id]))
    const missing = uniqueCats.filter((n) => !existingByLower.has(n.toLowerCase()))
    if (missing.length > 0) {
      const { data: inserted } = await service
        .from('material_categories')
        .insert(missing.map((name) => ({ organization_id: orgId, name })))
        .select('id, name') as { data: { id: string; name: string }[] | null }
      for (const r of inserted ?? []) existingByLower.set(r.name.toLowerCase(), r.id)
    }
    for (const n of uniqueCats) {
      const id = existingByLower.get(n.toLowerCase())
      if (id) categoryMap.set(n.toLowerCase(), id)
    }
  }

  return { typeMap, categoryMap }
}

export async function importMaterialsBatch(
  orgId: string,
  orgSlug: string,
  rows: MaterialImportRow[],
  startRowNumber: number, // 1-indexed CSV row number of the first row in this batch (for error reporting)
): Promise<{ error?: string; result?: ImportBatchResult }> {
  if (rows.length === 0) {
    return { result: { imported: 0, skipped: 0, errors: [] } }
  }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot import materials.' }

  const service = createServiceClient()
  const result: ImportBatchResult = { imported: 0, skipped: 0, errors: [] }

  // 1) Drop rows with no name — they're meaningless and would violate NOT NULL.
  const cleaned: { row: MaterialImportRow; csvRow: number }[] = []
  rows.forEach((r, i) => {
    const csvRow = startRowNumber + i
    if (!r.name || !r.name.trim()) {
      result.errors.push({ row: csvRow, name: '(blank)', message: 'Missing name' })
    } else {
      cleaned.push({ row: { ...r, name: r.name.trim() }, csvRow })
    }
  })
  if (cleaned.length === 0) return { result }

  // 2) Look up existing materials by name (case-insensitive) — skip dupes.
  // Build a lower-cased set of names from the batch and query in one shot.
  const namesLower = Array.from(new Set(cleaned.map((c) => c.row.name.toLowerCase())))
  const { data: existing, error: existingError } = await service
    .from('materials')
    .select('name')
    .eq('organization_id', orgId)
    .in('name', cleaned.map((c) => c.row.name)) // exact-case shortlist
  if (existingError) return { error: existingError.message }

  // The .in() above is exact-case. Catch case variations with a second
  // ilike fallback per unique name only if needed. For ShopVOX exports
  // names are usually consistent so the exact match catches almost all.
  const existingLower = new Set((existing ?? []).map((r) => r.name.toLowerCase()))
  if (existingLower.size < namesLower.length) {
    // Check the leftovers with a case-insensitive query in one batch.
    const leftover = namesLower.filter((n) => !existingLower.has(n))
    if (leftover.length > 0) {
      const { data: ciExisting } = await service
        .from('materials')
        .select('name')
        .eq('organization_id', orgId)
        .or(leftover.map((n) => `name.ilike.${n.replace(/[,()]/g, '')}`).join(','))
      for (const r of ciExisting ?? []) existingLower.add(r.name.toLowerCase())
    }
  }

  const toInsert = cleaned.filter(({ row }) => {
    if (existingLower.has(row.name.toLowerCase())) {
      result.skipped++
      return false
    }
    return true
  })
  if (toInsert.length === 0) return { result }

  // 3) Resolve type and category names to FK ids (auto-create missing).
  const { typeMap, categoryMap } = await resolveTypeAndCategoryIds(
    orgId,
    toInsert.map(({ row }) => row.type_name).filter((n): n is string => !!n),
    toInsert.map(({ row }) => row.category_name).filter((n): n is string => !!n),
  )

  // 4) Build insert payloads.
  const records = toInsert.map(({ row }) => ({
    organization_id: orgId,
    name: row.name,
    external_name: row.external_name,
    description: row.description,
    po_description: row.po_description,
    material_type_id: row.type_name ? typeMap.get(row.type_name.toLowerCase()) ?? null : null,
    category_id: row.category_name ? categoryMap.get(row.category_name.toLowerCase()) ?? null : null,
    cost: row.cost,
    price: row.price,
    multiplier: row.multiplier,
    buying_units: row.buying_units,
    selling_units: row.selling_units,
    sell_buy_ratio: row.sell_buy_ratio,
    per_li_unit: row.per_li_unit,
    formula: row.formula,
    width: row.width,
    height: row.height,
    fixed_side: row.fixed_side,
    fixed_quantity: row.fixed_quantity,
    sheet_cost: row.sheet_cost,
    wastage_markup: row.wastage_markup,
    calculate_wastage: row.calculate_wastage,
    allow_variants: row.allow_variants,
    weight: row.weight,
    weight_uom: row.weight_uom,
    labor_charge: row.labor_charge,
    machine_charge: row.machine_charge,
    other_charge: row.other_charge,
    setup_charge: row.setup_charge,
    cog_account_number: row.cog_account_number,
    cog_account_name: row.cog_account_name,
    part_number: row.part_number,
    sku: row.sku,
    preferred_vendor: row.preferred_vendor,
    info_url: row.info_url,
    image_url: row.image_url,
    include_in_base_price: row.include_in_base_price,
    percentage_of_base: row.percentage_of_base,
    track_inventory: row.track_inventory,
    in_use: row.in_use,
    active: row.active,
    show_internal: row.show_internal,
    created_by: user.id,
    updated_by: user.id,
  }))

  // 5) Bulk insert. If the batch fails as a whole, retry per-row to capture
  // which row(s) caused the failure so the user can see them in the summary.
  const { error: insertErr } = await service.from('materials').insert(records)
  if (insertErr) {
    // Per-row fallback
    for (let i = 0; i < records.length; i++) {
      const { error } = await service.from('materials').insert(records[i])
      if (error) {
        result.errors.push({
          row: toInsert[i].csvRow,
          name: toInsert[i].row.name,
          message: error.message,
        })
      } else {
        result.imported++
      }
    }
  } else {
    result.imported = records.length
  }

  return { result }
}

export async function revalidateMaterialsList(orgSlug: string): Promise<void> {
  revalidatePath(`/dashboard/${orgSlug}/settings/materials`)
}

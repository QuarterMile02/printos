'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'
import type { MaterialImportRow } from '@/lib/material-import-mapper'

type ServiceClient = ReturnType<typeof createServiceClient>

export type ImportBatchResult = {
  imported: number
  replaced: number
  skipped: number
  errors: { row: number; name: string; message: string }[]
}

// Conflict-detection types — returned to the client when names already
// exist. Client renders these in the shared ImportConflictModal and the
// user picks Skip / Replace / Keep Both per row before applyMaterialImport
// is called.
export type MaterialConflict = {
  conflict_key: string  // existing material id
  display_name: string
  existing: Record<string, string | number | null>
  incoming: Record<string, string | number | null>
}

export type ImportDecision = 'skip' | 'replace' | 'keep_both'

// Field labels shown in the conflict diff modal. Order matters — these
// render top-to-bottom in the modal. Kept short and human-readable.
const DIFF_FIELDS: { label: string; key: keyof MaterialImportRow | 'cost' | 'price' }[] = [
  { label: 'External name', key: 'external_name' },
  { label: 'Type', key: 'type_name' },
  { label: 'Category', key: 'category_name' },
  { label: 'Cost', key: 'cost' },
  { label: 'Price', key: 'price' },
  { label: 'Multiplier', key: 'multiplier' },
  { label: 'Width', key: 'width' },
  { label: 'Height', key: 'height' },
  { label: 'Buying units', key: 'buying_units' },
  { label: 'Selling units', key: 'selling_units' },
  { label: 'SKU', key: 'sku' },
  { label: 'Part #', key: 'part_number' },
  { label: 'Vendor', key: 'preferred_vendor' },
]

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
    return { result: { imported: 0, replaced: 0, skipped: 0, errors: [] } }
  }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot import materials.' }

  const service = createServiceClient()
  const result: ImportBatchResult = { imported: 0, replaced: 0, skipped: 0, errors: [] }

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

  // 2) Build an authoritative set of every existing material name in this
  // org (case-insensitive). We fetch all names — paged in 1000-row chunks
  // to bypass the PostgREST cap — and put them in a Set so we don't have
  // to escape special characters (commas, parentheses, slashes etc.) for
  // a server-side filter, which is where the prior version leaked dupes.
  const existingLower = new Set<string>()
  const PAGE_SIZE = 1000
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data: chunk, error: chunkError } = await service
      .from('materials')
      .select('name')
      .eq('organization_id', orgId)
      .range(from, to) as { data: { name: string }[] | null; error: { message: string } | null }
    if (chunkError) return { error: chunkError.message }
    if (!chunk || chunk.length === 0) break
    for (const r of chunk) existingLower.add(r.name.toLowerCase())
    if (chunk.length < PAGE_SIZE) break
  }

  // 3) Filter the batch:
  //   - skip rows whose name is already in the DB (case-insensitive)
  //   - skip rows whose name appears earlier in the SAME batch (intra-batch
  //     dedupe — keep first). Without this, two CSV rows with the same name
  //     would both pass since the DB lookup wouldn't see either yet.
  const seenInBatch = new Set<string>()
  const toInsert: { row: MaterialImportRow; csvRow: number }[] = []
  for (const item of cleaned) {
    const key = item.row.name.toLowerCase()
    if (existingLower.has(key) || seenInBatch.has(key)) {
      result.skipped++
      continue
    }
    seenInBatch.add(key)
    toInsert.push(item)
  }
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

// ────────────────────────────────────────────────────────────────────────
// Conflict detection + resolution flow.
//
// Two-step replacement for the old "silently skip duplicates" behaviour:
//   1. Client calls detectMaterialConflicts(orgId, rows) up front.
//   2. If conflicts.length > 0, client opens ImportConflictModal,
//      collects per-row decisions, then calls applyMaterialImport
//      with the original rows + decisions map.
//   3. Client falls back to the legacy importMaterialsBatch flow for
//      runs with no conflicts.
// ────────────────────────────────────────────────────────────────────────

type ExistingMaterialRow = {
  id: string
  name: string
  external_name: string | null
  cost: number | null
  price: number | null
  multiplier: number | null
  width: number | null
  height: number | null
  buying_units: string | null
  selling_units: string | null
  sku: string | null
  part_number: string | null
  preferred_vendor: string | null
  material_type_id: string | null
  category_id: string | null
}

function rowToDiffMap(row: MaterialImportRow): Record<string, string | number | null> {
  return {
    external_name: row.external_name,
    type_name: row.type_name,
    category_name: row.category_name,
    cost: row.cost,
    price: row.price,
    multiplier: row.multiplier,
    width: row.width,
    height: row.height,
    buying_units: row.buying_units,
    selling_units: row.selling_units,
    sku: row.sku,
    part_number: row.part_number,
    preferred_vendor: row.preferred_vendor,
  }
}

async function existingToDiffMap(
  service: ServiceClient,
  orgId: string,
  existing: ExistingMaterialRow,
): Promise<Record<string, string | number | null>> {
  // Resolve type/category ids back to names for the diff. Cache could be
  // added if conflict counts grow; n is small in practice.
  let type_name: string | null = null
  let category_name: string | null = null
  if (existing.material_type_id) {
    const { data } = await service
      .from('material_types').select('name')
      .eq('id', existing.material_type_id).maybeSingle() as { data: { name: string } | null }
    type_name = data?.name ?? null
  }
  if (existing.category_id) {
    const { data } = await service
      .from('material_categories').select('name')
      .eq('id', existing.category_id).maybeSingle() as { data: { name: string } | null }
    category_name = data?.name ?? null
  }
  return {
    external_name: existing.external_name,
    type_name,
    category_name,
    cost: existing.cost,
    price: existing.price,
    multiplier: existing.multiplier,
    width: existing.width,
    height: existing.height,
    buying_units: existing.buying_units,
    selling_units: existing.selling_units,
    sku: existing.sku,
    part_number: existing.part_number,
    preferred_vendor: existing.preferred_vendor,
  }
}

export async function detectMaterialConflicts(
  orgId: string,
  rows: MaterialImportRow[],
): Promise<{
  error?: string
  conflicts?: MaterialConflict[]
  cleanRows?: MaterialImportRow[]
  conflictRowMap?: Record<string, MaterialImportRow>
  diffFields?: { label: string; key: string }[]
}> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot import materials.' }

  const service = createServiceClient()

  // Build a lower-cased name → existing-row map. Page through to avoid
  // PostgREST 1000-row caps, mirroring the existing batch logic.
  const existingByName = new Map<string, ExistingMaterialRow>()
  const PAGE_SIZE = 1000
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data: chunk, error } = await service
      .from('materials')
      .select('id, name, external_name, cost, price, multiplier, width, height, buying_units, selling_units, sku, part_number, preferred_vendor, material_type_id, category_id')
      .eq('organization_id', orgId)
      .range(from, to) as { data: ExistingMaterialRow[] | null; error: { message: string } | null }
    if (error) return { error: error.message }
    if (!chunk || chunk.length === 0) break
    for (const r of chunk) existingByName.set(r.name.toLowerCase(), r)
    if (chunk.length < PAGE_SIZE) break
  }

  const conflicts: MaterialConflict[] = []
  const cleanRows: MaterialImportRow[] = []
  const conflictRowMap: Record<string, MaterialImportRow> = {}
  const seenInBatch = new Set<string>()

  for (const row of rows) {
    if (!row.name?.trim()) continue
    const key = row.name.trim().toLowerCase()
    const existing = existingByName.get(key)
    if (existing) {
      const diff: MaterialConflict = {
        conflict_key: existing.id,
        display_name: existing.name,
        existing: await existingToDiffMap(service, orgId, existing),
        incoming: rowToDiffMap(row),
      }
      conflicts.push(diff)
      conflictRowMap[existing.id] = row
    } else if (!seenInBatch.has(key)) {
      seenInBatch.add(key)
      cleanRows.push(row)
    }
    // Intra-batch duplicates beyond the first occurrence are dropped silently.
  }

  return {
    conflicts,
    cleanRows,
    conflictRowMap,
    diffFields: DIFF_FIELDS.map((f) => ({ label: f.label, key: String(f.key) })),
  }
}

export async function applyMaterialImport(
  orgId: string,
  orgSlug: string,
  cleanRows: MaterialImportRow[],
  conflictRowMap: Record<string, MaterialImportRow>,
  decisions: Record<string, ImportDecision>,
): Promise<{ error?: string; result?: ImportBatchResult }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot import materials.' }

  // Local-narrowed for the closure below — TS doesn't carry the null
  // narrowing of `user` into nested function scopes.
  const userId = user.id

  const service = createServiceClient()
  const result: ImportBatchResult = { imported: 0, replaced: 0, skipped: 0, errors: [] }

  // Bucket the conflict decisions.
  const inserts: MaterialImportRow[] = [...cleanRows]
  const updates: { existing_id: string; row: MaterialImportRow }[] = []
  const renames: MaterialImportRow[] = []
  for (const [existingId, decision] of Object.entries(decisions)) {
    const row = conflictRowMap[existingId]
    if (!row) continue
    if (decision === 'skip') {
      result.skipped++
    } else if (decision === 'replace') {
      updates.push({ existing_id: existingId, row })
    } else if (decision === 'keep_both') {
      renames.push({ ...row, name: `${row.name} (Import)` })
    }
  }
  inserts.push(...renames)

  // Resolve all type/category names across every row that's being written.
  const allTypeNames = [...inserts, ...updates.map((u) => u.row)]
    .map((r) => r.type_name).filter((n): n is string => !!n)
  const allCatNames = [...inserts, ...updates.map((u) => u.row)]
    .map((r) => r.category_name).filter((n): n is string => !!n)
  const { typeMap, categoryMap } = await resolveTypeAndCategoryIds(orgId, allTypeNames, allCatNames)

  function buildRecord(row: MaterialImportRow, includeOrgAndUser: boolean): Record<string, unknown> {
    const base: Record<string, unknown> = {
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
      updated_by: userId,
    }
    if (includeOrgAndUser) {
      base.organization_id = orgId
      base.created_by = userId
    }
    return base
  }

  // Inserts (clean rows + keep-both renames). Per-row to surface failures.
  for (const row of inserts) {
    const { error } = await service.from('materials').insert(buildRecord(row, true))
    if (error) result.errors.push({ row: 0, name: row.name, message: error.message })
    else result.imported++
  }

  // Updates (replace decisions).
  for (const { existing_id, row } of updates) {
    const { error } = await service
      .from('materials')
      .update(buildRecord(row, false))
      .eq('id', existing_id)
      .eq('organization_id', orgId)
    if (error) result.errors.push({ row: 0, name: row.name, message: error.message })
    else result.replaced++
  }

  revalidatePath(`/dashboard/${orgSlug}/settings/materials`)
  return { result }
}

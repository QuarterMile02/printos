'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'
import type { LaborRateImportRow } from '@/lib/labor-rate-import-mapper'

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

function calcProfitMargin(cost: number, price: number): number | null {
  if (price <= 0) return null
  return Number(((price - cost) / price * 100).toFixed(2))
}

export async function importLaborRatesBatch(
  orgId: string,
  orgSlug: string,
  rows: LaborRateImportRow[],
  startRowNumber: number, // 1-indexed CSV row number of the first row in this batch (for error reporting)
): Promise<{ error?: string; result?: ImportBatchResult }> {
  if (rows.length === 0) {
    return { result: { imported: 0, skipped: 0, errors: [] } }
  }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot import labor rates.' }

  const service = createServiceClient()
  const result: ImportBatchResult = { imported: 0, skipped: 0, errors: [] }

  // 1) Drop rows with no name — they're meaningless and would violate NOT NULL.
  const cleaned: { row: LaborRateImportRow; csvRow: number }[] = []
  rows.forEach((r, i) => {
    const csvRow = startRowNumber + i
    if (!r.name || !r.name.trim()) {
      result.errors.push({ row: csvRow, name: '(blank)', message: 'Missing name' })
    } else {
      cleaned.push({ row: { ...r, name: r.name.trim() }, csvRow })
    }
  })
  if (cleaned.length === 0) return { result }

  // 2) Build an authoritative set of every existing labor rate name in this
  // org (case-insensitive), paged in 1000-row chunks to bypass PostgREST's
  // default cap. Using a Set avoids fragile escaping of special characters.
  const existingLower = new Set<string>()
  const PAGE_SIZE = 1000
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data: chunk, error: chunkError } = await service
      .from('labor_rates')
      .select('name')
      .eq('organization_id', orgId)
      .range(from, to) as { data: { name: string }[] | null; error: { message: string } | null }
    if (chunkError) return { error: chunkError.message }
    if (!chunk || chunk.length === 0) break
    for (const r of chunk) existingLower.add(r.name.toLowerCase())
    if (chunk.length < PAGE_SIZE) break
  }

  // 3) Skip rows already in DB or duplicated within the same batch.
  const seenInBatch = new Set<string>()
  const toInsert: { row: LaborRateImportRow; csvRow: number }[] = []
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

  // 3) Build insert payloads.
  const records = toInsert.map(({ row }) => ({
    organization_id: orgId,
    name: row.name,
    external_name: row.external_name,
    cost: row.cost,
    price: row.price,
    markup: row.markup,
    formula: row.formula,
    units: row.units,
    setup_charge: row.setup_charge,
    machine_charge: row.machine_charge,
    other_charge: row.other_charge,
    include_in_base_price: row.include_in_base_price,
    per_li_unit: row.per_li_unit,
    cog_account: row.cog_account,
    description: row.description,
    display_name: row.display_name,
    show_internal: row.show_internal,
    active: row.active,
    profit_margin_pct: calcProfitMargin(row.cost, row.price),
    created_by: user.id,
    updated_by: user.id,
  }))

  // 4) Bulk insert. If the batch fails as a whole, retry per-row to capture
  // which row(s) caused the failure so the user can see them in the summary.
  const { error: insertErr } = await service.from('labor_rates').insert(records)
  if (insertErr) {
    for (let i = 0; i < records.length; i++) {
      const { error } = await service.from('labor_rates').insert(records[i])
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

export async function revalidateLaborRatesList(orgSlug: string): Promise<void> {
  revalidatePath(`/dashboard/${orgSlug}/settings/labor-rates`)
}

'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'
import type { ProductImportRow } from '@/lib/product-import-mapper'

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

// Look up category and workflow names. Categories are auto-created on the
// fly (same as material categories). Workflow templates are NOT auto-created
// — they have downstream stages/structure, so we just leave the FK null when
// no match exists and report the unresolved name in errors so the user can
// fix it after import.
async function resolveLookups(
  orgId: string,
  categoryNames: string[],
  workflowNames: string[],
): Promise<{
  categoryMap: Map<string, string>
  workflowMap: Map<string, string>
  unresolvedWorkflows: Set<string>
}> {
  const service = createServiceClient()

  // Categories — auto-create
  const categoryMap = new Map<string, string>()
  const uniqueCats = Array.from(new Set(categoryNames.map((n) => n.trim()).filter(Boolean)))
  if (uniqueCats.length > 0) {
    const { data: existing } = await service
      .from('product_categories')
      .select('id, name')
      .eq('organization_id', orgId) as { data: { id: string; name: string }[] | null }
    const byLower = new Map((existing ?? []).map((r) => [r.name.toLowerCase(), r.id]))
    const missing = uniqueCats.filter((n) => !byLower.has(n.toLowerCase()))
    if (missing.length > 0) {
      const { data: inserted } = await service
        .from('product_categories')
        .insert(missing.map((name) => ({ organization_id: orgId, name })))
        .select('id, name') as { data: { id: string; name: string }[] | null }
      for (const r of inserted ?? []) byLower.set(r.name.toLowerCase(), r.id)
    }
    for (const n of uniqueCats) {
      const id = byLower.get(n.toLowerCase())
      if (id) categoryMap.set(n.toLowerCase(), id)
    }
  }

  // Workflow templates — lookup only
  const workflowMap = new Map<string, string>()
  const unresolvedWorkflows = new Set<string>()
  const uniqueWfs = Array.from(new Set(workflowNames.map((n) => n.trim()).filter(Boolean)))
  if (uniqueWfs.length > 0) {
    const { data: existing } = await service
      .from('workflow_templates')
      .select('id, name')
      .eq('organization_id', orgId) as { data: { id: string; name: string }[] | null }
    const byLower = new Map((existing ?? []).map((r) => [r.name.toLowerCase(), r.id]))
    for (const n of uniqueWfs) {
      const id = byLower.get(n.toLowerCase())
      if (id) workflowMap.set(n.toLowerCase(), id)
      else unresolvedWorkflows.add(n)
    }
  }

  return { categoryMap, workflowMap, unresolvedWorkflows }
}

export async function importProductsBatch(
  orgId: string,
  orgSlug: string,
  rows: ProductImportRow[],
  startRowNumber: number,
): Promise<{ error?: string; result?: ImportBatchResult }> {
  if (rows.length === 0) {
    return { result: { imported: 0, skipped: 0, errors: [] } }
  }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot import products.' }

  const service = createServiceClient()
  const result: ImportBatchResult = { imported: 0, skipped: 0, errors: [] }

  // 1) Drop rows with no name.
  const cleaned: { row: ProductImportRow; csvRow: number }[] = []
  rows.forEach((r, i) => {
    const csvRow = startRowNumber + i
    if (!r.name || !r.name.trim()) {
      result.errors.push({ row: csvRow, name: '(blank)', message: 'Missing name' })
    } else {
      cleaned.push({ row: { ...r, name: r.name.trim() }, csvRow })
    }
  })
  if (cleaned.length === 0) return { result }

  // 2) Dedup by name (case-insensitive). Two-step: exact-match IN query
  // first, then ilike fallback for any names not caught.
  const { data: existing, error: existingError } = await service
    .from('products')
    .select('name')
    .eq('organization_id', orgId)
    .in('name', cleaned.map((c) => c.row.name))
  if (existingError) return { error: existingError.message }

  const existingLower = new Set((existing ?? []).map((r) => r.name.toLowerCase()))
  const namesLower = cleaned.map((c) => c.row.name.toLowerCase())
  if (existingLower.size < new Set(namesLower).size) {
    const leftover = Array.from(new Set(namesLower)).filter((n) => !existingLower.has(n))
    if (leftover.length > 0) {
      const { data: ciExisting } = await service
        .from('products')
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

  // 3) Resolve FK lookups (category auto-create, workflow lookup only).
  const { categoryMap, workflowMap, unresolvedWorkflows } = await resolveLookups(
    orgId,
    toInsert.map(({ row }) => row.category_name).filter((n): n is string => !!n),
    toInsert.map(({ row }) => row.workflow_template_name).filter((n): n is string => !!n),
  )

  // 4) Build insert payloads.
  const records = toInsert.map(({ row }) => ({
    organization_id: orgId,
    name: row.name,
    description: row.description,
    part_number: row.part_number,
    sku: row.sku,
    category_id: row.category_name ? categoryMap.get(row.category_name.toLowerCase()) ?? null : null,
    secondary_category: row.secondary_category,
    product_type: row.product_type,
    pricing_type: row.pricing_type,
    formula: row.formula,
    show_feet_inches: row.show_feet_inches,
    cost: row.cost,
    price: row.price,
    markup: row.markup,
    units: row.units,
    buying_units: row.buying_units,
    workflow_template_id:
      row.workflow_template_name
        ? workflowMap.get(row.workflow_template_name.toLowerCase()) ?? null
        : null,
    min_line_price: row.min_line_price,
    min_unit_price: row.min_unit_price,
    taxable: row.taxable,
    image_url: row.image_url,
    production_details: row.production_details,
    published: row.published,
    active: row.active,
    status: row.published ? 'published' : 'draft',
    created_by: user.id,
    updated_by: user.id,
  }))

  // 5) Bulk insert with per-row fallback on failure.
  const { error: insertErr } = await service.from('products').insert(records)
  if (insertErr) {
    for (let i = 0; i < records.length; i++) {
      const { error } = await service.from('products').insert(records[i])
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

  // 6) Surface unresolved workflow names as soft warnings (one per name)
  // so the user knows which products got null FKs and need fixing.
  for (const wf of unresolvedWorkflows) {
    result.errors.push({
      row: 0,
      name: `(workflow: ${wf})`,
      message: `Workflow template "${wf}" not found — products referencing it were imported with no workflow.`,
    })
  }

  return { result }
}

export async function revalidateProductsList(orgSlug: string): Promise<void> {
  revalidatePath(`/dashboard/${orgSlug}/products`)
}

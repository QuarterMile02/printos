'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { redirect } from 'next/navigation'

function numOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null) return null
  const s = (v as string).trim()
  if (s === '') return null
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null
  const s = (v as string).trim()
  return s === '' ? null : s
}

export async function saveMaterial(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string

  const fields: Record<string, unknown> = {
    name: formData.get('name') as string,
    external_name: strOrNull(formData.get('external_name')),
    cost: parseFloat(formData.get('cost') as string) || 0,
    price: parseFloat(formData.get('price') as string) || 0,
    multiplier: parseFloat(formData.get('multiplier') as string) || 2,
    buying_units: strOrNull(formData.get('buying_units')),
    selling_units: strOrNull(formData.get('selling_units')),
    formula: (formData.get('formula') as string) || 'Area',
    fixed_side: strOrNull(formData.get('fixed_side')),
    width: numOrNull(formData.get('width')),
    height: numOrNull(formData.get('height')),
    sheet_cost: numOrNull(formData.get('sheet_cost')),
    wastage_markup: parseFloat(formData.get('wastage_markup') as string) || 0,
    sell_buy_ratio: parseFloat(formData.get('sell_buy_ratio') as string) || 1,
    preferred_vendor: strOrNull(formData.get('preferred_vendor')),
    labor_charge: parseFloat(formData.get('labor_charge') as string) || 0,
    machine_charge: parseFloat(formData.get('machine_charge') as string) || 0,
    setup_charge: parseFloat(formData.get('setup_charge') as string) || 0,
    active: formData.get('active') === 'on',
    // FK classification fields
    material_type_id: strOrNull(formData.get('material_type_id')),
    category_id: strOrNull(formData.get('category_id')),
    material_type: null,
    material_category: null,
    unit_width: numOrNull(formData.get('unit_width')),
    unit_height: numOrNull(formData.get('unit_height')),
    unit_cost: numOrNull(formData.get('unit_cost')),
    other_charge: numOrNull(formData.get('other_charge')),
    per_li_unit: formData.get('per_li_unit') === 'on',
    calculate_wastage: formData.get('calculate_wastage') === 'on',
    include_in_base_price: formData.get('include_in_base_price') === 'on',
    discount_id: strOrNull(formData.get('discount_id')),
    part_number: strOrNull(formData.get('part_number')),
    sku: strOrNull(formData.get('sku')),
    weight: numOrNull(formData.get('weight')),
    weight_uom: strOrNull(formData.get('weight_uom')),
    cog_account: strOrNull(formData.get('cog_account')),
    qb_item_type: strOrNull(formData.get('qb_item_type')),
    po_description: strOrNull(formData.get('po_description')),
    info_url: strOrNull(formData.get('info_url')),
    print_image_on_pdf: formData.get('print_image_on_pdf') === 'on',
    show_internal: formData.get('show_internal') === 'on',
    display_description_in_li: formData.get('display_description_in_li') === 'on',
    description: strOrNull(formData.get('description')),
    updated_at: new Date().toISOString(),
  }

  // Inventory fields — only written if the caller has materials.edit_inventory.
  // Checked here (server action) regardless of what the form renders,
  // so direct POST submissions can't bypass the permission gate.
  if (formData.has('current_stock') || formData.has('min_stock_level') || formData.has('reorder_quantity')) {
    const { allowed } = await checkPermission(orgId, 'materials.edit_inventory')
    if (allowed) {
      const curRaw = formData.get('current_stock') as string | null
      const minRaw = formData.get('min_stock_level') as string | null
      const reoRaw = formData.get('reorder_quantity') as string | null
      if (curRaw !== null) fields.current_stock = parseFloat(curRaw) || 0
      if (minRaw !== null) fields.min_stock_level = parseFloat(minRaw) || 0
      if (reoRaw !== null) fields.reorder_quantity = parseFloat(reoRaw) || 0
      // Stamp the count timestamp whenever stock level is explicitly saved
      if (curRaw !== null) fields.last_inventory_count_at = new Date().toISOString()
    }
  }

  const service = createServiceClient()

  if (id) {
    const { error } = await service.from('materials').update(fields).eq('id', id)
    if (error) redirect(`/dashboard/${orgSlug}/settings/materials/${id}?edit=1&error=${encodeURIComponent(error.message)}`)
    redirect(`/dashboard/${orgSlug}/settings/materials/${id}`)
  } else {
    fields.organization_id = orgId
    const { data, error } = await service.from('materials').insert(fields).select('id').single()
    if (error) redirect(`/dashboard/${orgSlug}/settings/materials/new?error=${encodeURIComponent(error.message)}`)
    const newId = (data as { id: string } | null)?.id
    redirect(`/dashboard/${orgSlug}/settings/materials${newId ? '/' + newId : ''}`)
  }
}

export async function cloneMaterial(formData: FormData) {
  const sourceId = formData.get('sourceId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string

  const service = createServiceClient()
  const { data: src, error: srcErr } = await service.from('materials').select('name, external_name, cost, price, multiplier, buying_units, selling_units, formula, fixed_side, width, height, sheet_cost, wastage_markup, sell_buy_ratio, preferred_vendor, labor_charge, machine_charge, setup_charge, active').eq('id', sourceId).single()
  if (srcErr || !src) redirect(`/dashboard/${orgSlug}/settings/materials?error=${encodeURIComponent(srcErr?.message ?? 'Material not found')}`)
  const s = src as Record<string, unknown>

  const { data: inserted, error: insErr } = await service.from('materials').insert({
    ...s, organization_id: orgId, name: s.name + ' (copy)',
  }).select('id').single()
  if (insErr) redirect(`/dashboard/${orgSlug}/settings/materials?error=${encodeURIComponent(insErr.message)}`)
  const newId = (inserted as { id: string } | null)?.id
  redirect(`/dashboard/${orgSlug}/settings/materials${newId ? '/' + newId + '?edit=1' : ''}`)
}

export async function deleteMaterial(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()
  const { error } = await service.from('materials').delete().eq('id', id)
  if (error) redirect(`/dashboard/${orgSlug}/settings/materials/${id}?edit=1&error=${encodeURIComponent(error.message)}`)
  redirect(`/dashboard/${orgSlug}/settings/materials`)
}

export async function importMaterialsCsv(formData: FormData): Promise<{ created: number; updated: number; errors: number }> {
  const file = formData.get('file') as File | null
  const orgId = formData.get('orgId') as string
  if (!file) return { created: 0, updated: 0, errors: 0 }

  const text = await file.text()
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return { created: 0, updated: 0, errors: 0 }

  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase())
  const nameIdx = headers.indexOf('name')
  if (nameIdx < 0) return { created: 0, updated: 0, errors: 0 }

  const service = createServiceClient()
  const { data: existing, error: existingErr } = await service.from('materials').select('id, name').eq('organization_id', orgId)
  if (existingErr) return { created: 0, updated: 0, errors: lines.length - 1 }
  const nameToId = new Map<string, string>()
  for (const r of existing as { id: string; name: string }[]) nameToId.set(r.name.toLowerCase(), r.id)

  let created = 0, updated = 0, errors = 0
  const map: Record<string, string> = { 'external name': 'external_name', cost: 'cost', price: 'price', multiplier: 'multiplier', 'buying units': 'buying_units', 'selling units': 'selling_units', formula: 'formula', width: 'width', height: 'height', 'wastage markup': 'wastage_markup', 'labor charge': 'labor_charge', 'machine charge': 'machine_charge', 'setup charge': 'setup_charge', 'preferred vendor': 'preferred_vendor', active: 'active' }
  const numericCols = new Set(['cost', 'price', 'multiplier', 'width', 'height', 'wastage_markup', 'labor_charge', 'machine_charge', 'setup_charge'])

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.replace(/"/g, '').trim())
    const name = vals[nameIdx]
    if (!name) { errors++; continue }

    const row: Record<string, unknown> = { name }
    for (const [h, col] of Object.entries(map)) {
      const idx = headers.indexOf(h)
      if (idx >= 0 && vals[idx]) {
        if (numericCols.has(col)) row[col] = parseFloat(vals[idx]) || 0
        else if (col === 'active') row[col] = vals[idx].toLowerCase() === 'true'
        else row[col] = vals[idx]
      }
    }

    const existingId = nameToId.get(name.toLowerCase())
    if (existingId) {
      const { error } = await service.from('materials').update(row).eq('id', existingId)
      if (error) errors++
      else updated++
    } else {
      row.organization_id = orgId
      const { error } = await service.from('materials').insert(row)
      if (error) errors++
      else created++
    }
  }
  return { created, updated, errors }
}

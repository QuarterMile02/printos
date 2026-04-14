'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveMaterial(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string

  const fields: Record<string, unknown> = {
    name: formData.get('name') as string,
    external_name: (formData.get('external_name') as string) || null,
    cost: parseFloat(formData.get('cost') as string) || 0,
    price: parseFloat(formData.get('price') as string) || 0,
    multiplier: parseFloat(formData.get('multiplier') as string) || 2,
    buying_units: (formData.get('buying_units') as string) || null,
    selling_units: (formData.get('selling_units') as string) || null,
    formula: (formData.get('formula') as string) || 'Area',
    fixed_side: (formData.get('fixed_side') as string) || null,
    width: parseFloat(formData.get('width') as string) || null,
    height: parseFloat(formData.get('height') as string) || null,
    sheet_cost: parseFloat(formData.get('sheet_cost') as string) || null,
    wastage_markup: parseFloat(formData.get('wastage_markup') as string) || 0,
    sell_buy_ratio: parseFloat(formData.get('sell_buy_ratio') as string) || 1,
    preferred_vendor: (formData.get('preferred_vendor') as string) || null,
    labor_charge: parseFloat(formData.get('labor_charge') as string) || 0,
    machine_charge: parseFloat(formData.get('machine_charge') as string) || 0,
    setup_charge: parseFloat(formData.get('setup_charge') as string) || 0,
    active: formData.get('active') === 'on',
    updated_at: new Date().toISOString(),
  }

  const service = createServiceClient()

  if (id) {
    await service.from('materials').update(fields).eq('id', id)
    redirect(`/dashboard/${orgSlug}/settings/materials/${id}`)
  } else {
    fields.organization_id = orgId
    const { data } = await service.from('materials').insert(fields).select('id').single()
    const newId = (data as { id: string } | null)?.id
    redirect(`/dashboard/${orgSlug}/settings/materials${newId ? '/' + newId : ''}`)
  }
}

export async function cloneMaterial(formData: FormData) {
  const sourceId = formData.get('sourceId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string

  const service = createServiceClient()
  const { data: src } = await service.from('materials').select('name, external_name, cost, price, multiplier, buying_units, selling_units, formula, fixed_side, width, height, sheet_cost, wastage_markup, sell_buy_ratio, preferred_vendor, labor_charge, machine_charge, setup_charge, active').eq('id', sourceId).single()
  if (!src) throw new Error('Material not found')
  const s = src as Record<string, unknown>

  const { data: inserted } = await service.from('materials').insert({
    ...s, organization_id: orgId, name: s.name + ' (copy)',
  }).select('id').single()
  const newId = (inserted as { id: string } | null)?.id
  redirect(`/dashboard/${orgSlug}/settings/materials${newId ? '/' + newId + '?edit=1' : ''}`)
}

export async function deleteMaterial(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()
  await service.from('materials').delete().eq('id', id)
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
  const { data: existing } = await service.from('materials').select('id, name').eq('organization_id', orgId)
  const nameToId = new Map<string, string>()
  for (const r of (existing ?? []) as { id: string; name: string }[]) nameToId.set(r.name.toLowerCase(), r.id)

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
      await service.from('materials').update(row).eq('id', existingId)
      updated++
    } else {
      row.organization_id = orgId
      await service.from('materials').insert(row)
      created++
    }
  }
  return { created, updated, errors }
}

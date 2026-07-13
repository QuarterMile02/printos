'use server'

import { createServiceClient } from '@/lib/supabase/server'
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

function parseRate(fd: FormData) {
  const materialIds = fd.getAll('material_category_ids').map(v => v as string).filter(Boolean)
  return {
    name: fd.get('name') as string,
    external_name: strOrNull(fd.get('external_name')),
    cost: parseFloat(fd.get('cost') as string) || 0,
    price: parseFloat(fd.get('price') as string) || 0,
    markup: (() => { const c = parseFloat(fd.get('cost') as string) || 0; const p = parseFloat(fd.get('price') as string) || 0; return c > 0 ? Math.round((p / c) * 10000) / 10000 : 1 })(),
    formula: (fd.get('formula') as string) || 'Area',
    units: (fd.get('units') as string) || 'Sqft',
    setup_charge: parseFloat(fd.get('setup_charge') as string) || 0,
    labor_charge: parseFloat(fd.get('labor_charge') as string) || 0,
    other_charge: parseFloat(fd.get('other_charge') as string) || 0,
    include_in_base_price: fd.get('include_in_base_price') === 'on',
    production_rate: numOrNull(fd.get('production_rate')),
    production_rate_units: strOrNull(fd.get('production_rate_units')),
    description: strOrNull(fd.get('description')),
    show_internal: fd.get('show_internal') === 'on',
    display_name_in_line_item: fd.get('display_name_in_line_item') === 'on',
    active: fd.get('active') === 'on',
    // Migration 046 fields
    category: strOrNull(fd.get('category')),
    subcategory: strOrNull(fd.get('subcategory')),
    material_category_ids: materialIds.length > 0 ? materialIds : null,
    linked_labor_rate_id: strOrNull(fd.get('linked_labor_rate_id')),
    margin_width: numOrNull(fd.get('margin_width')),
    margin_height: numOrNull(fd.get('margin_height')),
    difficulty: strOrNull(fd.get('difficulty')),
    per_li_unit: fd.get('per_li_unit') === 'on',
    cog_account: strOrNull(fd.get('cog_account')),
    volume_discount_id: strOrNull(fd.get('volume_discount_id')),
    department_id: strOrNull(fd.get('department_id')),
    calc_equipment_cost: numOrNull(fd.get('calc_equipment_cost')),
    calc_life_expectancy_years: numOrNull(fd.get('calc_life_expectancy_years')),
    calc_days_per_year: numOrNull(fd.get('calc_days_per_year')),
    calc_hours_per_day: numOrNull(fd.get('calc_hours_per_day')),
    calc_productivity_percent: numOrNull(fd.get('calc_productivity_percent')),
    updated_at: new Date().toISOString(),
  }
}

export async function saveMachineRate(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const fields = parseRate(formData)
  const service = createServiceClient()

  let savedId = id
  if (id) {
    await service.from('machine_rates').update(fields).eq('id', id)
  } else {
    const { data: inserted } = await service
      .from('machine_rates')
      .insert({ ...fields, organization_id: orgId })
      .select('id')
      .single()
    savedId = (inserted as { id: string } | null)?.id ?? null
  }
  redirect(savedId
    ? `/dashboard/${orgSlug}/settings/machine-rates?edit=${savedId}&saved=1`
    : `/dashboard/${orgSlug}/settings/machine-rates`)
}

export async function deleteMachineRate(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()
  await service.from('machine_rates').delete().eq('id', id)
  redirect(`/dashboard/${orgSlug}/settings/machine-rates`)
}

export async function cloneMachineRate(formData: FormData) {
  const sourceId = formData.get('sourceId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const targetTable = formData.get('targetTable') as string

  const service = createServiceClient()
  const { data: src } = await service.from('machine_rates').select('name, cost, price, markup, formula, units, setup_charge, other_charge, include_in_base_price, production_rate, production_rate_units, description, show_internal, active').eq('id', sourceId).single()
  if (!src) throw new Error('Rate not found')
  const s = src as Record<string, unknown>

  const clone = {
    organization_id: orgId,
    name: s.name + ' (copy)',
    cost: s.cost, price: s.price, markup: s.markup,
    formula: s.formula, units: s.units,
    setup_charge: s.setup_charge, other_charge: s.other_charge,
    include_in_base_price: s.include_in_base_price,
    production_rate: s.production_rate, production_rate_units: s.production_rate_units,
    description: s.description, show_internal: s.show_internal, active: true,
  }

  const { data: inserted } = await service.from(targetTable).insert(clone).select('id').single()
  const newId = (inserted as { id: string } | null)?.id
  const path = targetTable === 'machine_rates' ? 'machine-rates' : 'labor-rates'
  redirect(`/dashboard/${orgSlug}/settings/${path}${newId ? '?edit=' + newId : ''}`)
}

export async function importMachineRatesCsv(formData: FormData): Promise<{ created: number; updated: number; errors: number }> {
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
  const { data: existing } = await service.from('machine_rates').select('id, name').eq('organization_id', orgId)
  const nameToId = new Map<string, string>()
  for (const r of (existing ?? []) as { id: string; name: string }[]) nameToId.set(r.name.toLowerCase(), r.id)

  let created = 0, updated = 0, errors = 0
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.replace(/"/g, '').trim())
    const name = vals[nameIdx]
    if (!name) { errors++; continue }

    const row: Record<string, unknown> = { name }
    const map: Record<string, string> = { 'external name': 'external_name', cost: 'cost', price: 'price', markup: 'markup', units: 'units', formula: 'formula', 'setup charge': 'setup_charge', 'labor charge': 'labor_charge', 'other charge': 'other_charge', 'production rate': 'production_rate', active: 'active' }
    for (const [h, col] of Object.entries(map)) {
      const idx = headers.indexOf(h)
      if (idx >= 0 && vals[idx]) {
        if (['cost', 'price', 'markup', 'setup_charge', 'labor_charge', 'other_charge', 'production_rate'].includes(col)) row[col] = parseFloat(vals[idx]) || 0
        else if (col === 'active') row[col] = vals[idx].toLowerCase() === 'true'
        else row[col] = vals[idx]
      }
    }

    const existingId = nameToId.get(name.toLowerCase())
    if (existingId) {
      await service.from('machine_rates').update(row).eq('id', existingId)
      updated++
    } else {
      row.organization_id = orgId
      await service.from('machine_rates').insert(row)
      created++
    }
  }
  return { created, updated, errors }
}

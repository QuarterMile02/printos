'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

function parseRate(fd: FormData) {
  return {
    name: fd.get('name') as string,
    external_name: (fd.get('external_name') as string) || null,
    cost: parseFloat(fd.get('cost') as string) || 0,
    price: parseFloat(fd.get('price') as string) || 0,
    markup: (() => { const c = parseFloat(fd.get('cost') as string) || 0; const p = parseFloat(fd.get('price') as string) || 0; return c > 0 ? Math.round((p / c) * 10000) / 10000 : 1 })(),
    formula: (fd.get('formula') as string) || 'Unit',
    units: (fd.get('units') as string) || 'Hr',
    setup_charge: parseFloat(fd.get('setup_charge') as string) || 0,
    machine_charge: parseFloat(fd.get('machine_charge') as string) || 0,
    other_charge: parseFloat(fd.get('other_charge') as string) || 0,
    include_in_base_price: fd.get('include_in_base_price') === 'on',
    production_rate: parseFloat(fd.get('production_rate') as string) || null,
    production_rate_units: (fd.get('production_rate_units') as string) || null,
    description: (fd.get('description') as string) || null,
    show_internal: fd.get('show_internal') === 'on',
    display_name_in_line_item: fd.get('display_name_in_line_item') === 'on',
    active: fd.get('active') === 'on',
    updated_at: new Date().toISOString(),
  }
}

export async function saveLaborRate(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const fields = parseRate(formData)
  const service = createServiceClient()

  if (id) {
    await service.from('labor_rates').update(fields).eq('id', id)
  } else {
    await service.from('labor_rates').insert({ ...fields, organization_id: orgId })
  }
  redirect(`/dashboard/${orgSlug}/settings/labor-rates`)
}

export async function deleteLaborRate(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()
  await service.from('labor_rates').delete().eq('id', id)
  redirect(`/dashboard/${orgSlug}/settings/labor-rates`)
}

export async function cloneLaborRate(formData: FormData) {
  const sourceId = formData.get('sourceId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const targetTable = formData.get('targetTable') as string // 'labor_rates' or 'machine_rates'

  const service = createServiceClient()
  const { data: src } = await service.from('labor_rates').select('name, cost, price, markup, formula, units, setup_charge, other_charge, include_in_base_price, production_rate, production_rate_units, description, show_internal, active').eq('id', sourceId).single()
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

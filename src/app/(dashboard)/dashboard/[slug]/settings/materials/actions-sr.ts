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

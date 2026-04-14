'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveMachineRate(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = formData.get('name') as string
  const cost = parseFloat(formData.get('cost') as string) || 0
  const price = parseFloat(formData.get('price') as string) || 0
  const markup = cost > 0 ? Math.round((price / cost) * 10000) / 10000 : 1
  const formula = formData.get('formula') as string || null
  const units = formData.get('units') as string || null
  const active = formData.get('active') === 'on'

  const service = createServiceClient()

  if (id) {
    await service.from('machine_rates').update({
      name, cost, price, markup, formula, units, active,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
  } else {
    await service.from('machine_rates').insert({
      organization_id: orgId, name, cost, price, markup, formula, units, active,
    })
  }

  redirect(`/dashboard/${orgSlug}/settings/machine-rates`)
}

export async function deleteMachineRate(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()
  await service.from('machine_rates').delete().eq('id', id)
  redirect(`/dashboard/${orgSlug}/settings/machine-rates`)
}

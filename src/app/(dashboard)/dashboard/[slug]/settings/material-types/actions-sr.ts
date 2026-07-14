'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveMaterialType(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = (formData.get('name') as string).trim()
  const is_active = formData.get('is_active') === 'on'

  const service = createServiceClient()
  let savedId = id
  if (id) {
    await service.from('material_types').update({ name, is_active }).eq('id', id)
  } else {
    const { data } = await service
      .from('material_types')
      .insert({ organization_id: orgId, name, is_active })
      .select('id')
      .single()
    savedId = (data as { id: string } | null)?.id ?? null
  }
  redirect(savedId
    ? `/dashboard/${orgSlug}/settings/material-types?edit=${savedId}&saved=1`
    : `/dashboard/${orgSlug}/settings/material-types`)
}

export async function deleteMaterialType(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()
  const { count } = await service
    .from('materials')
    .select('id', { count: 'exact', head: true })
    .eq('material_type_id', id)
  if (!count) {
    await service.from('material_types').delete().eq('id', id)
  }
  redirect(`/dashboard/${orgSlug}/settings/material-types`)
}

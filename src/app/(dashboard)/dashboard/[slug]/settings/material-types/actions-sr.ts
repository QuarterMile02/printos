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
    const { error } = await service.from('material_types').update({ name, is_active }).eq('id', id)
    if (error) redirect(`/dashboard/${orgSlug}/settings/material-types?edit=${id}&error=${encodeURIComponent(error.message)}`)
  } else {
    const { data, error } = await service
      .from('material_types')
      .insert({ organization_id: orgId, name, is_active })
      .select('id')
      .single()
    if (error) redirect(`/dashboard/${orgSlug}/settings/material-types?add=1&error=${encodeURIComponent(error.message)}`)
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

  // Delete requires BOTH: already deactivated, AND zero linked records.
  const { data: type } = await service.from('material_types').select('is_active').eq('id', id).maybeSingle()
  if (type?.is_active !== false) {
    redirect(`/dashboard/${orgSlug}/settings/material-types?error=${encodeURIComponent('Cannot delete — material type must be deactivated first.')}`)
  }

  const { count, error: countError } = await service
    .from('materials')
    .select('id', { count: 'exact', head: true })
    .eq('material_type_id', id)
  if (countError) redirect(`/dashboard/${orgSlug}/settings/material-types?error=${encodeURIComponent(countError.message)}`)
  if (count) {
    redirect(`/dashboard/${orgSlug}/settings/material-types?error=${encodeURIComponent(`Cannot delete — used by ${count} material${count === 1 ? '' : 's'}. Modify those first.`)}`)
  }
  const { error } = await service.from('material_types').delete().eq('id', id)
  if (error) redirect(`/dashboard/${orgSlug}/settings/material-types?error=${encodeURIComponent(error.message)}`)
  redirect(`/dashboard/${orgSlug}/settings/material-types`)
}

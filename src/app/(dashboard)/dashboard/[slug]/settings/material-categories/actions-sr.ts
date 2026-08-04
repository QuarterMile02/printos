'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveMaterialCategory(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = (formData.get('name') as string).trim()
  const material_type_id = (formData.get('material_type_id') as string) || null
  const is_active = formData.get('is_active') === 'on'

  const service = createServiceClient()
  let savedId = id
  if (id) {
    const { error } = await service.from('material_categories').update({ name, material_type_id, is_active }).eq('id', id)
    if (error) redirect(`/dashboard/${orgSlug}/settings/material-categories?edit=${id}&error=${encodeURIComponent(error.message)}`)
  } else {
    const { data, error } = await service
      .from('material_categories')
      .insert({ organization_id: orgId, name, material_type_id, is_active })
      .select('id')
      .single()
    if (error) redirect(`/dashboard/${orgSlug}/settings/material-categories?add=1&error=${encodeURIComponent(error.message)}`)
    savedId = (data as { id: string } | null)?.id ?? null
  }
  redirect(savedId
    ? `/dashboard/${orgSlug}/settings/material-categories?edit=${savedId}&saved=1`
    : `/dashboard/${orgSlug}/settings/material-categories`)
}

export async function deleteMaterialCategory(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()

  // Delete requires BOTH: already deactivated, AND zero linked records.
  const { data: category } = await service.from('material_categories').select('is_active').eq('id', id).maybeSingle()
  if (category?.is_active !== false) {
    redirect(`/dashboard/${orgSlug}/settings/material-categories?error=${encodeURIComponent('Cannot delete — category must be deactivated first.')}`)
  }

  const { count, error: countError } = await service
    .from('materials')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id)
  if (countError) redirect(`/dashboard/${orgSlug}/settings/material-categories?error=${encodeURIComponent(countError.message)}`)
  if (count) {
    redirect(`/dashboard/${orgSlug}/settings/material-categories?error=${encodeURIComponent(`Cannot delete — used by ${count} material${count === 1 ? '' : 's'}. Modify those first.`)}`)
  }
  const { error } = await service.from('material_categories').delete().eq('id', id)
  if (error) redirect(`/dashboard/${orgSlug}/settings/material-categories?error=${encodeURIComponent(error.message)}`)
  redirect(`/dashboard/${orgSlug}/settings/material-categories`)
}

'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveGeneralCategory(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = (formData.get('name') as string).trim()
  const type = formData.get('type') as string
  const sub_type = (formData.get('sub_type') as string | null) || null
  const is_active = formData.get('is_active') === 'on'
  const returnSubType = (formData.get('returnSubType') as string | null) || ''

  const service = createServiceClient()
  let savedId = id
  if (id) {
    const { error } = await service.from('general_categories').update({ name, type, sub_type, is_active }).eq('id', id)
    if (error) {
      const p = new URLSearchParams({ edit: id, error: error.message })
      redirect(`/dashboard/${orgSlug}/settings/general-categories?${p.toString()}`)
    }
  } else {
    const { data, error } = await service
      .from('general_categories')
      .insert({ organization_id: orgId, name, type, sub_type, is_active })
      .select('id')
      .single()
    if (error) {
      const p = new URLSearchParams({ add: '1', error: error.message })
      redirect(`/dashboard/${orgSlug}/settings/general-categories?${p.toString()}`)
    }
    savedId = (data as { id: string } | null)?.id ?? null
  }

  const params = new URLSearchParams()
  if (savedId) params.set('edit', savedId)
  params.set('saved', '1')
  if (returnSubType) params.set('sub_type', returnSubType)

  redirect(`/dashboard/${orgSlug}/settings/general-categories?${params.toString()}`)
}

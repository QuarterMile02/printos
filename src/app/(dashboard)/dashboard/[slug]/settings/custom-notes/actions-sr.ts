'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveCustomNote(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const title = (formData.get('title') as string).trim()
  const body = (formData.get('body') as string).trim()
  const type = formData.get('type') as string
  const is_active = formData.get('is_active') === 'on'

  const service = createServiceClient()
  let savedId = id
  if (id) {
    await service.from('custom_notes').update({ title, body, type, is_active }).eq('id', id)
  } else {
    const { data } = await service
      .from('custom_notes')
      .insert({ organization_id: orgId, title, body, type, is_active })
      .select('id')
      .single()
    savedId = (data as { id: string } | null)?.id ?? null
  }
  redirect(savedId
    ? `/dashboard/${orgSlug}/settings/custom-notes?edit=${savedId}&saved=1`
    : `/dashboard/${orgSlug}/settings/custom-notes`)
}

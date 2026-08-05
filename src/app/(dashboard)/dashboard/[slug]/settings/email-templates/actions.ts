'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveEmailTemplate(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string

  const fields: Record<string, unknown> = {
    name: formData.get('name') as string,
    subject: formData.get('subject') as string,
    body: formData.get('body') as string,
    trigger_event: (formData.get('trigger_event') as string) || 'manual',
    is_active: formData.get('is_active') === 'on',
    updated_at: new Date().toISOString(),
  }

  const service = createServiceClient()

  if (id) {
    const { error } = await service.from('email_templates').update(fields).eq('id', id)
    if (error) redirect(`/dashboard/${orgSlug}/settings/email-templates/${id}?edit=1&error=${encodeURIComponent(error.message)}`)
    redirect(`/dashboard/${orgSlug}/settings/email-templates/${id}`)
  } else {
    fields.organization_id = orgId
    const { data, error } = await service.from('email_templates').insert(fields).select('id').single()
    if (error) redirect(`/dashboard/${orgSlug}/settings/email-templates/new?edit=1&error=${encodeURIComponent(error.message)}`)
    const newId = (data as { id: string } | null)?.id
    redirect(`/dashboard/${orgSlug}/settings/email-templates${newId ? '/' + newId : ''}`)
  }
}

export async function deleteEmailTemplate(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()
  const { error } = await service.from('email_templates').delete().eq('id', id)
  if (error) redirect(`/dashboard/${orgSlug}/settings/email-templates/${id}?edit=1&error=${encodeURIComponent(error.message)}`)
  redirect(`/dashboard/${orgSlug}/settings/email-templates`)
}

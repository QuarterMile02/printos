'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveEmailTemplate(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string

  // department is a multi-select checkbox group — same `name="department"`
  // on every checkbox, so getAll collects every checked value.
  const department = formData.getAll('department') as string[]

  const fields: Record<string, unknown> = {
    name: formData.get('name') as string,
    subject: formData.get('subject') as string,
    body: formData.get('body') as string,
    trigger_event: (formData.get('trigger_event') as string) || 'manual',
    is_active: formData.get('is_active') === 'on',
    department,
    ai_personalize: formData.get('ai_personalize') === 'on',
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

// Duplicates a template's content into a new row so it can be reassigned
// to a different department and renamed/edited without touching the
// original. Lands the user directly in edit mode on the new copy.
export async function cloneEmailTemplate(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()

  const { data: source, error: fetchError } = await service
    .from('email_templates')
    .select('organization_id, name, subject, body, trigger_event, department, ai_personalize')
    .eq('id', id)
    .maybeSingle()
  if (fetchError || !source) {
    redirect(`/dashboard/${orgSlug}/settings/email-templates?error=${encodeURIComponent(fetchError?.message ?? 'Template not found')}`)
  }

  const { data: inserted, error: insertError } = await service
    .from('email_templates')
    .insert({
      organization_id: source.organization_id,
      name: `${source.name} (Copy)`,
      subject: source.subject,
      body: source.body,
      trigger_event: source.trigger_event,
      department: source.department,
      ai_personalize: source.ai_personalize,
      is_active: false, // cloned templates start inactive until reviewed/renamed
    })
    .select('id')
    .single()
  if (insertError || !inserted) {
    redirect(`/dashboard/${orgSlug}/settings/email-templates?error=${encodeURIComponent(insertError?.message ?? 'Clone failed')}`)
  }

  redirect(`/dashboard/${orgSlug}/settings/email-templates/${(inserted as { id: string }).id}?edit=1`)
}

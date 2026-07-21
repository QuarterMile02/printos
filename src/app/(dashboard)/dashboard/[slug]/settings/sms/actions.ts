'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

function rev(orgSlug: string) {
  revalidatePath(`/dashboard/${orgSlug}/settings/sms`)
}

// ─── SMS Settings ────────────────────────────────────────────────────────────

export async function upsertSmsSettings(
  orgId: string,
  orgSlug: string,
  patch: Partial<{
    twilio_account_sid: string | null
    twilio_auth_token: string | null
    twilio_phone_number: string | null
    country_code: string
    is_connected: boolean
  }>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('sms_settings')
    .upsert(
      { organization_id: orgId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' },
    )
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

export async function disconnectSms(orgId: string, orgSlug: string): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('sms_settings')
    .upsert(
      {
        organization_id: orgId,
        twilio_account_sid: null,
        twilio_auth_token: null,
        twilio_phone_number: null,
        is_connected: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' },
    )
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

// ─── SMS Templates ────────────────────────────────────────────────────────────

type TemplateData = { name: string; body: string; sort_order?: number }

export async function createSmsTemplate(
  orgId: string,
  orgSlug: string,
  data: TemplateData,
): Promise<{ data?: Record<string, unknown>; error?: string }> {
  const svc = createServiceClient()
  const { data: row, error } = await svc
    .from('sms_templates')
    .insert({ organization_id: orgId, ...data })
    .select()
    .single()
  if (error) return { error: error.message }
  rev(orgSlug)
  return { data: row as Record<string, unknown> }
}

export async function updateSmsTemplate(
  id: string,
  orgId: string,
  orgSlug: string,
  data: Partial<TemplateData>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('sms_templates')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

export async function deleteSmsTemplate(
  id: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('sms_templates')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

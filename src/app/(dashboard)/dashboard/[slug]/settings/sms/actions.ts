'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { encryptCredential } from '@/lib/credential-crypto'

function rev(orgSlug: string) {
  revalidatePath(`/dashboard/${orgSlug}/settings/sms`)
}

// ─── SMS Settings ────────────────────────────────────────────────────────────

// twilio_account_sid/twilio_auth_token are encrypted at rest (see
// src/lib/credential-crypto.ts) -- same pattern as carrier_connections and
// payment_gateway_settings. The client never receives decrypted (or even
// encrypted) values (see sms-client.tsx / page.tsx), so a blank/omitted
// field means "leave unchanged," not "clear it" -- these are independent
// scalar columns, so simply not including a falsy field in the upsert
// payload already leaves it untouched; no fetch-and-merge needed. Clearing
// only happens via disconnectSms.
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
  const row: Record<string, unknown> = { organization_id: orgId, updated_at: new Date().toISOString() }
  if (patch.twilio_phone_number !== undefined) row.twilio_phone_number = patch.twilio_phone_number
  if (patch.country_code !== undefined) row.country_code = patch.country_code
  if (patch.is_connected !== undefined) row.is_connected = patch.is_connected
  if (patch.twilio_account_sid?.trim()) row.twilio_account_sid = encryptCredential(patch.twilio_account_sid.trim())
  if (patch.twilio_auth_token?.trim()) row.twilio_auth_token = encryptCredential(patch.twilio_auth_token.trim())

  const { error } = await svc
    .from('sms_settings')
    .upsert(row, { onConflict: 'organization_id' })
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
        twilio_account_sid: null, // clearing to null needs no encryption
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

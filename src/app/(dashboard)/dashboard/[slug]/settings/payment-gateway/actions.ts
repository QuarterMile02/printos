'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

function rev(orgSlug: string) {
  revalidatePath(`/dashboard/${orgSlug}/settings/payment-gateway`)
}

export async function upsertPaymentGateway(
  orgId: string,
  orgSlug: string,
  patch: Partial<{
    gateway_type: string
    api_login_id: string | null
    transaction_key: string | null
    use_test_mode: boolean
    is_connected: boolean
  }>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('payment_gateway_settings')
    .upsert(
      { organization_id: orgId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' },
    )
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

export async function disconnectPaymentGateway(
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('payment_gateway_settings')
    .upsert(
      {
        organization_id: orgId,
        api_login_id: null,
        transaction_key: null,
        is_connected: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' },
    )
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

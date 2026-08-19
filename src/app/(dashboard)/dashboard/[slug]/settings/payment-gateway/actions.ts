'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { encryptCredential } from '@/lib/credential-crypto'

function rev(orgSlug: string) {
  revalidatePath(`/dashboard/${orgSlug}/settings/payment-gateway`)
}

// api_login_id/transaction_key are encrypted at rest (see src/lib/credential-crypto.ts).
// The client never receives decrypted values (see payment-gateway-client.tsx / page.tsx),
// so a blank/omitted field means "leave unchanged," not "clear it" -- unlike
// carrier_connections' jsonb column, these are independent scalar columns, so simply
// not including a falsy field in the upsert payload already leaves it untouched; no
// fetch-and-merge needed. Clearing only happens via disconnectPaymentGateway.
export async function upsertPaymentGateway(
  orgId: string,
  orgSlug: string,
  patch: Partial<{
    gateway_type: string
    api_login_id: string | null
    transaction_key: string | null
    client_key: string | null
    use_test_mode: boolean
    is_connected: boolean
  }>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const row: Record<string, unknown> = { organization_id: orgId, updated_at: new Date().toISOString() }
  if (patch.gateway_type !== undefined) row.gateway_type = patch.gateway_type
  if (patch.use_test_mode !== undefined) row.use_test_mode = patch.use_test_mode
  if (patch.is_connected !== undefined) row.is_connected = patch.is_connected
  if (patch.api_login_id?.trim()) row.api_login_id = encryptCredential(patch.api_login_id.trim())
  if (patch.transaction_key?.trim()) row.transaction_key = encryptCredential(patch.transaction_key.trim())
  if (patch.client_key?.trim()) row.client_key = encryptCredential(patch.client_key.trim())

  const { error } = await svc
    .from('payment_gateway_settings')
    .upsert(row, { onConflict: 'organization_id' })
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
        client_key: null,
        is_connected: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' },
    )
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

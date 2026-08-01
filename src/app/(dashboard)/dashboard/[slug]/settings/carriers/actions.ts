'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

function rev(orgSlug: string) {
  revalidatePath(`/dashboard/${orgSlug}/settings/carriers`)
}

// Credentials are stored PLAINTEXT in jsonb — matches the existing
// payment_gateway_settings pattern. Encryption at rest for both tables
// is a tracked follow-up, not done in this pass.
export async function upsertCarrierConnection(
  orgId: string,
  orgSlug: string,
  carrier: string,
  patch: Partial<{
    credentials: Record<string, string>
    use_test_mode: boolean
    is_connected: boolean
  }>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('carrier_connections')
    .upsert(
      { organization_id: orgId, carrier, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id,carrier' },
    )
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

export async function disconnectCarrierConnection(
  orgId: string,
  orgSlug: string,
  carrier: string,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('carrier_connections')
    .upsert(
      {
        organization_id: orgId,
        carrier,
        credentials: {},
        is_connected: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,carrier' },
    )
  if (error) return { error: error.message }
  rev(orgSlug)
  return {}
}

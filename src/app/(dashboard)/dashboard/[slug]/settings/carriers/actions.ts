'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { encryptCredential } from '@/lib/credential-crypto'

function rev(orgSlug: string) {
  revalidatePath(`/dashboard/${orgSlug}/settings/carriers`)
}

// Credentials are encrypted at rest (AES-256-GCM, see src/lib/credential-crypto.ts).
// The client never receives decrypted values (see carriers-client.tsx / page.tsx), so a
// blank field means "leave unchanged" here, not "clear this field" -- clearing only
// happens via disconnectCarrierConnection. `credentials` on the jsonb column is a full
// replace on upsert (not a merge), so any field the caller doesn't include here must be
// filled in from the existing stored (still-encrypted) value before writing, or it would
// be silently dropped.
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

  let credentials: Record<string, string> | undefined
  if (patch.credentials) {
    const { data: existing } = await svc
      .from('carrier_connections')
      .select('credentials')
      .eq('organization_id', orgId)
      .eq('carrier', carrier)
      .maybeSingle()
    credentials = { ...((existing as { credentials: Record<string, string> } | null)?.credentials ?? {}) }
    for (const [key, value] of Object.entries(patch.credentials)) {
      if (value?.trim()) credentials[key] = encryptCredential(value.trim())
      // else: no new value typed for this field -- keep whatever's already stored
    }
  }

  const { error } = await svc
    .from('carrier_connections')
    .upsert(
      {
        organization_id: orgId,
        carrier,
        ...patch,
        ...(credentials ? { credentials } : {}),
        updated_at: new Date().toISOString(),
      },
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

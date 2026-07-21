'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function upsertOrgProfile(
  orgId: string,
  orgSlug: string,
  patch: Partial<{
    legal_name: string | null
    dba_name: string | null
    phone: string | null
    email: string | null
    website: string | null
    street: string | null
    city: string | null
    state: string | null
    zip: string | null
    country: string | null
    tax_id: string | null
    logo_url: string | null
    tagline: string | null
    footer_note: string | null
  }>,
): Promise<{ error?: string }> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('org_profile')
    .upsert(
      { organization_id: orgId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' },
    )
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/settings/billing`)
  return {}
}

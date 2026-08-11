'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'

export type FormFieldSettingRow = {
  id: string
  field_key: string
  field_label: string
  is_visible: boolean
  is_required: boolean
  sort_order: number
}

async function getMembership(orgId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, membership: null }
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }
  return { user, membership }
}

// Owner/admin only, matching migration 124's RLS write policies -- this
// setting changes what every user in the org sees/must fill on every
// quote, job, invoice, etc., a higher blast radius than most settings
// tables, so it's gated tighter than the usual "any non-viewer" pattern.
export async function updateFormFieldSettings(
  orgId: string,
  orgSlug: string,
  formType: string,
  updates: { field_key: string; is_visible: boolean; is_required: boolean }[],
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return { error: 'Only owners and admins can change form settings.' }
  }

  const service = createServiceClient()
  for (const u of updates) {
    // Required implies visible -- enforced client-side already (see
    // form-fields-client.tsx), re-enforced here since this is the actual
    // write path; matches the DB CHECK constraint in migration 124.
    const is_required = u.is_required && u.is_visible
    const { error } = await service
      .from('form_field_settings')
      .update({ is_visible: u.is_visible, is_required, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('form_type', formType)
      .eq('field_key', u.field_key)
    if (error) return { error: error.message }
  }

  revalidatePath(`/dashboard/${orgSlug}/settings/forms/${formType}`)
  return {}
}

'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'
import type { ModifierType } from '@/types/product-builder'

export type ModifierFormData = {
  display_name: string
  system_lookup_name: string | null
  modifier_type: ModifierType
  units: string | null
  range_min_label: string | null
  range_max_label: string | null
  range_min_value: number | null
  range_max_value: number | null
  range_default_value: number | null
  range_step_interval: number | null
  show_internally: boolean
  show_customer: boolean
  is_system_variable: boolean
  active: boolean
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

function buildRecord(data: ModifierFormData) {
  return {
    name: data.display_name.trim(),
    display_name: data.display_name.trim(),
    system_lookup_name: data.system_lookup_name?.trim() || null,
    modifier_type: data.modifier_type,
    units: data.modifier_type === 'Boolean' ? null : data.units,
    range_min_label: data.modifier_type === 'Range' ? data.range_min_label : null,
    range_max_label: data.modifier_type === 'Range' ? data.range_max_label : null,
    range_min_value: data.modifier_type === 'Range' ? data.range_min_value : null,
    range_max_value: data.modifier_type === 'Range' ? data.range_max_value : null,
    range_default_value: data.modifier_type === 'Range' ? data.range_default_value : null,
    range_step_interval: data.modifier_type === 'Range' ? data.range_step_interval : null,
    show_internally: data.show_internally,
    show_customer: data.show_customer,
    is_system_variable: data.is_system_variable,
    active: data.active,
  }
}

export async function createModifier(
  orgId: string,
  orgSlug: string,
  data: ModifierFormData
): Promise<{ error?: string; id?: string }> {
  if (!data.display_name.trim()) return { error: 'Display name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create modifiers.' }

  const service = createServiceClient()
  const { data: inserted, error } = await service
    .from('modifiers')
    .insert({
      organization_id: orgId,
      ...buildRecord(data),
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/settings/modifiers`)
  return { id: inserted?.id }
}

export async function updateModifier(
  id: string,
  orgId: string,
  orgSlug: string,
  data: ModifierFormData
): Promise<{ error?: string }> {
  if (!data.display_name.trim()) return { error: 'Display name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update modifiers.' }

  const service = createServiceClient()
  const { error } = await service
    .from('modifiers')
    .update({ ...buildRecord(data), updated_by: user.id })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/settings/modifiers`)
  return {}
}

export async function toggleModifierActive(
  id: string,
  orgId: string,
  orgSlug: string,
  active: boolean
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update modifiers.' }

  const service = createServiceClient()
  const { error } = await service
    .from('modifiers')
    .update({ active, updated_by: user.id })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/settings/modifiers`)
  return {}
}

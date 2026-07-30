'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'

export type PricingFormulaFormData = {
  name: string
  formula: string
  uom: string
  description: string
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

export async function createPricingFormula(
  orgId: string,
  orgSlug: string,
  data: PricingFormulaFormData,
): Promise<{ error?: string }> {
  if (!data.name.trim()) return { error: 'Name is required.' }
  if (!data.formula.trim()) return { error: 'Formula is required.' }
  if (!data.uom.trim()) return { error: 'Result unit is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create pricing formulas.' }

  const service = createServiceClient()
  const { error } = await service
    .from('pricing_formulas')
    .insert({
      organization_id: orgId,
      name: data.name.trim(),
      formula: data.formula.trim(),
      uom: data.uom.trim(),
      description: data.description.trim() || null,
      is_system: false,
    })

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/settings/pricing-formulas`)
  return {}
}

// TEMPORARY: gated to the 'owner' role directly because there is no real
// Team Roles & Permissions system yet — once one exists, replace this
// role === 'owner' check with a proper permission check (e.g.
// checkPermission(orgId, 'pricing_formulas.edit')) and remove this comment.
export async function updatePricingFormula(
  id: string,
  orgId: string,
  orgSlug: string,
  data: PricingFormulaFormData,
): Promise<{ error?: string }> {
  if (!data.name.trim()) return { error: 'Name is required.' }
  if (!data.formula.trim()) return { error: 'Formula is required.' }
  if (!data.uom.trim()) return { error: 'Result unit is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role !== 'owner') return { error: 'Only the organization owner can edit pricing formulas.' }

  const service = createServiceClient()
  const { error } = await service
    .from('pricing_formulas')
    .update({
      name: data.name.trim(),
      formula: data.formula.trim(),
      uom: data.uom.trim(),
      description: data.description.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', orgId)
    .eq('is_system', false)
    // is_locked formulas are read-only for everyone, including the
    // owner, until explicitly unlocked via setPricingFormulaLock.
    .eq('is_locked', false)

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/settings/pricing-formulas`)
  return {}
}

// TEMPORARY: see comment on updatePricingFormula above — owner-only is a
// stand-in until real Team Roles & Permissions exists.
export async function deletePricingFormula(
  id: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role !== 'owner') return { error: 'Only the organization owner can delete pricing formulas.' }

  const service = createServiceClient()
  const { error } = await service
    .from('pricing_formulas')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
    .eq('is_system', false)
    .eq('is_locked', false)

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/settings/pricing-formulas`)
  return {}
}

// TEMPORARY: see comment on updatePricingFormula above — owner-only is a
// stand-in until real Team Roles & Permissions exists. Locking is
// intentionally unavailable for is_system formulas: those are already
// permanently read-only for everyone via a separate, harder mechanism
// (is_system), so a lock toggle on them would be meaningless.
export async function setPricingFormulaLock(
  id: string,
  orgId: string,
  orgSlug: string,
  locked: boolean,
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role !== 'owner') return { error: 'Only the organization owner can lock or unlock pricing formulas.' }

  const service = createServiceClient()
  const { error } = await service
    .from('pricing_formulas')
    .update({ is_locked: locked, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)
    .eq('is_system', false)

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/settings/pricing-formulas`)
  return {}
}

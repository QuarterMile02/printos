'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'
import type { Role, Tier } from '@/lib/permissions'
import { ALL_ROLES, ALL_TIERS } from '@/lib/permissions'

const INVITABLE_ROLES: OrgRole[] = ['admin', 'designer', 'accountant', 'member', 'viewer']

export async function inviteMember(
  orgId: string,
  orgSlug: string,
  formData: FormData
): Promise<{ error?: string }> {
  const email = (formData.get('email') as string | null)?.trim().toLowerCase()
  const role = (formData.get('role') as string | null) as OrgRole | null

  if (!email) return { error: 'Email is required.' }
  if (!role || !INVITABLE_ROLES.includes(role)) return { error: 'Invalid role.' }

  // Verify the caller is an owner or admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return { error: 'Only owners and admins can invite members.' }
  }

  // Check if user is already a member (via service client to query auth.users)
  const service = createServiceClient()
  const { data: existingMembers } = await service
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)

  // Check auth.users for existing email
  const { data: { users: allUsers } } = await service.auth.admin.listUsers()
  const targetUser = allUsers?.find((u) => u.email === email)

  if (targetUser) {
    const alreadyMember = (existingMembers ?? []).some((m) => m.user_id === targetUser.id)
    if (alreadyMember) return { error: 'This user is already a member of this organization.' }
  }

  // Check for existing pending invite
  type InviteRow = { id: string; status: string }
  const { data: existingInvite } = await service
    .from('organization_invites')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('email', email)
    .eq('status', 'pending')
    .maybeSingle() as { data: InviteRow | null; error: unknown }

  if (existingInvite) return { error: 'A pending invite already exists for this email.' }

  // Create the invite
  const { error: insertError } = await service
    .from('organization_invites')
    .insert({
      organization_id: orgId,
      email,
      role,
      invited_by: user.id,
    })

  if (insertError) return { error: insertError.message }

  revalidatePath(`/dashboard/${orgSlug}/team-members`)
  return {}
}

export async function updateMemberProfile(
  targetUserId: string,
  orgId: string,
  orgSlug: string,
  fields: {
    role?: string
    tier?: string
    departments?: string[]
    title?: string
    phone?: string
  },
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  // Only owner can change role/tier; owner/manager can change departments
  const service = createServiceClient()
  const { data: callerProfile } = await service
    .from('profiles')
    .select('role, tier')
    .eq('id', user.id)
    .maybeSingle() as { data: { role: string; tier: string } | null; error: unknown }

  if (!callerProfile) return { error: 'Profile not found.' }

  const isOwner = callerProfile.role === 'owner'
  const isManager = callerProfile.tier === 'manager' || callerProfile.tier === 'lead'

  // Only owner can change role or tier
  if (fields.role !== undefined && !isOwner) {
    return { error: 'Only owners can change roles.' }
  }
  if (fields.tier !== undefined && !isOwner) {
    return { error: 'Only owners can change tiers.' }
  }
  // Owner or manager can change departments
  if (fields.departments !== undefined && !isOwner && !isManager) {
    return { error: 'Only owners and managers can assign departments.' }
  }

  // Validate values
  if (fields.role && !ALL_ROLES.includes(fields.role as Role)) {
    return { error: 'Invalid role.' }
  }
  if (fields.tier && !ALL_TIERS.includes(fields.tier as Tier)) {
    return { error: 'Invalid tier.' }
  }

  const update: Record<string, unknown> = {}
  if (fields.role !== undefined) update.role = fields.role
  if (fields.tier !== undefined) update.tier = fields.tier
  if (fields.departments !== undefined) update.departments = fields.departments
  if (fields.title !== undefined) update.title = fields.title || null
  if (fields.phone !== undefined) update.phone = fields.phone || null
  if (Object.keys(update).length === 0) return {}

  const { error } = await service
    .from('profiles')
    .update(update)
    .eq('id', targetUserId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/team-members`)
  return {}
}

// ── Permission Overrides ──────────────────────────────────────────

export type PermissionOverride = {
  id: string
  permission_key: string
  granted: boolean
  note: string | null
}

export async function getPermissionOverrides(
  targetUserId: string,
  orgId: string,
): Promise<{ overrides: PermissionOverride[]; error?: string }> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('permission_overrides')
    .select('id, permission_key, granted, note')
    .eq('user_id', targetUserId)
    .eq('organization_id', orgId)
    .order('permission_key') as {
      data: PermissionOverride[] | null
      error: { message: string } | null
    }

  if (error) return { overrides: [], error: error.message }
  return { overrides: data ?? [] }
}

export async function setPermissionOverride(
  targetUserId: string,
  orgId: string,
  orgSlug: string,
  permissionKey: string,
  granted: boolean,
  note?: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const service = createServiceClient()
  const { data: callerProfile } = await service
    .from('profiles')
    .select('role, tier')
    .eq('id', user.id)
    .maybeSingle() as { data: { role: string; tier: string } | null; error: unknown }

  if (!callerProfile) return { error: 'Profile not found.' }
  const canManage = callerProfile.role === 'owner' || callerProfile.tier === 'manager' || callerProfile.tier === 'lead'
  if (!canManage) return { error: 'Only owners and managers can manage permission overrides.' }

  const { error } = await service
    .from('permission_overrides')
    .upsert(
      {
        user_id: targetUserId,
        organization_id: orgId,
        permission_key: permissionKey,
        granted,
        granted_by: user.id,
        granted_at: new Date().toISOString(),
        note: note || null,
      },
      { onConflict: 'user_id,permission_key' },
    )

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/team-members`)
  return {}
}

export async function removePermissionOverride(
  targetUserId: string,
  orgId: string,
  orgSlug: string,
  permissionKey: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const service = createServiceClient()
  const { data: callerProfile } = await service
    .from('profiles')
    .select('role, tier')
    .eq('id', user.id)
    .maybeSingle() as { data: { role: string; tier: string } | null; error: unknown }

  if (!callerProfile) return { error: 'Profile not found.' }
  const canManage = callerProfile.role === 'owner' || callerProfile.tier === 'manager' || callerProfile.tier === 'lead'
  if (!canManage) return { error: 'Only owners and managers can manage permission overrides.' }

  const { error } = await service
    .from('permission_overrides')
    .delete()
    .eq('user_id', targetUserId)
    .eq('organization_id', orgId)
    .eq('permission_key', permissionKey)

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/team-members`)
  return {}
}

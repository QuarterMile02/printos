'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'

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

  const service = createServiceClient()
  const { data: existingMembers } = await service
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)

  const { data: { users: allUsers } } = await service.auth.admin.listUsers()
  const targetUser = allUsers?.find((u) => u.email === email)

  if (targetUser) {
    const alreadyMember = (existingMembers ?? []).some((m) => m.user_id === targetUser.id)
    if (alreadyMember) return { error: 'This user is already a member of this organization.' }
  }

  type InviteRow = { id: string; status: string }
  const { data: existingInvite } = await service
    .from('organization_invites')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('email', email)
    .eq('status', 'pending')
    .maybeSingle() as { data: InviteRow | null; error: unknown }

  if (existingInvite) return { error: 'A pending invite already exists for this email.' }

  const { error: insertError } = await service
    .from('organization_invites')
    .insert({
      organization_id: orgId,
      email,
      role,
      invited_by: user.id,
    })

  if (insertError) return { error: insertError.message }

  revalidatePath(`/dashboard/${orgSlug}/settings/team`)
  return {}
}

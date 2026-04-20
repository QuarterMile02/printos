import { createClient, createServiceClient } from '@/lib/supabase/server'
import { hasPermission } from '@/lib/permissions'
import type { Role, Tier } from '@/lib/permissions'

type ProfileRow = {
  role: string
  tier: string
  departments: string[]
  organization_id: string | null
}

type OverrideRow = {
  permission_key: string
  granted: boolean
}

// Server-side permission check for use in server components and server actions.
// Returns { allowed: true, profile } or { allowed: false }.
//
// Resolution order:
// 1. profiles.id = auth user.id → evaluate via hasPermission().
// 2. If no profile row, fall back to organization_members for the given orgId.
//    An org member with role 'owner' or 'admin' is treated as an owner for
//    permission purposes — covers the case where the profile row is missing
//    or out of sync but membership is intact.
// 3. Otherwise deny.
export async function checkPermission(
  orgId: string,
  permission: string,
): Promise<{ allowed: boolean; profile?: ProfileRow }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { allowed: false }

  const service = createServiceClient()

  // 1. Fetch profile by auth user id
  const { data: profile } = await service
    .from('profiles')
    .select('role, tier, departments, organization_id')
    .eq('id', user.id)
    .maybeSingle() as { data: ProfileRow | null; error: unknown }

  if (profile) {
    // Fetch overrides (best-effort — table may be missing on older DBs)
    let overrides: OverrideRow[] = []
    try {
      const { data } = await service
        .from('permission_overrides')
        .select('permission_key, granted')
        .eq('user_id', user.id)
        .eq('organization_id', orgId) as { data: OverrideRow[] | null; error: unknown }
      overrides = data ?? []
    } catch {
      // permission_overrides table may not exist yet
    }

    const allowed = hasPermission(
      { role: (profile.role ?? 'production') as Role, tier: (profile.tier ?? 'staff') as Tier },
      overrides,
      permission,
    )
    return { allowed, profile }
  }

  // 2. Fallback: organization_members table — if the user is listed as
  // owner or admin in the requested org, treat as owner.
  const { data: membership } = await service
    .from('organization_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (membership && (membership.role === 'owner' || membership.role === 'admin')) {
    return {
      allowed: true,
      profile: {
        role: 'owner',
        tier: 'manager',
        departments: [],
        organization_id: orgId,
      },
    }
  }

  return { allowed: false }
}

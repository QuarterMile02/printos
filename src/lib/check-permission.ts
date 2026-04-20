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
export async function checkPermission(
  orgId: string,
  permission: string,
): Promise<{ allowed: boolean; profile?: ProfileRow }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { allowed: false }

  const service = createServiceClient()

  // Fetch profile
  const { data: profile } = await service
    .from('profiles')
    .select('role, tier, departments, organization_id')
    .eq('id', user.id)
    .maybeSingle() as { data: ProfileRow | null; error: unknown }

  if (!profile) return { allowed: false }

  // Fetch overrides
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
    { role: profile.role as Role, tier: profile.tier as Tier },
    overrides,
    permission,
  )

  return { allowed, profile }
}

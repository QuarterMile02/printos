// Explicit org-membership check for API routes that take a resource id
// (product, order, org id, etc.) from the client and need to know the
// CALLER actually belongs to that resource's real organization.
//
// Deliberately does NOT delegate this to checkPermission(orgId, perm):
// checkPermission resolves the caller's own profile by user id and
// evaluates their role/tier permission table WITHOUT checking that
// profile.organization_id matches the orgId argument at all (it only
// scopes by orgId in its organization_members fallback branch, i.e.
// when the caller has no profiles row). A user with a permissive role
// in their own org (up to and including 'owner', which is a role-wide
// '*': true wildcard) passes checkPermission(otherOrgId, anything) even
// though they have no relationship to otherOrgId whatsoever. See
// known-issues/checkpermission-org-scoping.md — that's a systemic gap
// in checkPermission itself, out of scope to fix here (71 call sites),
// but every route in this sweep needs real org-boundary enforcement, so
// they resolve membership independently via this helper instead of
// trusting checkPermission's orgId argument for that job. Callers that
// also want role/permission-key gating on top should AND this with a
// checkPermission(...) call -- membership alone doesn't imply the role
// has the specific permission.
import { createClient, createServiceClient } from '@/lib/supabase/server'

// All organization ids the current authenticated user actually belongs
// to: their profile's home org (if any) plus every org they appear in
// via organization_members. Returns null if there is no session at all.
export async function getUserOrgIds(): Promise<Set<string> | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const service = createServiceClient()
  const ids = new Set<string>()

  const { data: profile } = await service
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle() as { data: { organization_id: string | null } | null; error: unknown }
  if (profile?.organization_id) ids.add(profile.organization_id)

  const { data: memberships } = await service
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id) as { data: { organization_id: string }[] | null; error: unknown }
  for (const m of memberships ?? []) ids.add(m.organization_id)

  return ids
}

// Convenience wrapper: true only if there's a session AND that session's
// user belongs to orgId.
export async function userBelongsToOrg(orgId: string): Promise<boolean> {
  const ids = await getUserOrgIds()
  return !!ids && ids.has(orgId)
}

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
// 1. profiles.id = auth user.id AND profile.organization_id === orgId →
//    evaluate via hasPermission().
// 2. Otherwise (no profile row, OR a profile whose home org isn't orgId),
//    fall back to organization_members for the given orgId. An org member
//    with role 'owner' or 'admin' is treated as an owner for permission
//    purposes — covers a missing/out-of-sync profile row with intact
//    membership, and the multi-org user whose profile points elsewhere.
// 3. Otherwise deny.
//
// ── The org check in step 1 (added 2026-08-30) ──────────────────────────
// This function used to evaluate role/tier from the profile WITHOUT ever
// comparing profile.organization_id to the orgId argument. Because
// hasPermission() is role/tier-based and 'owner' is a blanket {'*': true},
// an owner of Org A passed checkPermission(orgB_id, anything) for an org
// they had no relationship to — a cross-tenant authorization bypass, not a
// permission-granularity issue. Written up at the time in
// known-issues/2026-08-19-checkpermission-org-scoping-gap.md and left open
// because the blast radius (110 call sites) needed its own PR. This is that
// PR: the gate lives HERE so all 110 sites inherit it without being edited.
//
// The routes that PR #20 defensively paired with userBelongsToOrg() keep
// that pairing. It is now redundant, deliberately — defence in depth on the
// auth backbone is worth more than the duplication costs.
//
// Deliberately NOT used by any cron job or webhook: /api/cron/* and
// /api/webhooks/* legitimately act across orgs and authenticate with a
// bearer token or HMAC instead. Verified zero call sites there before
// making this change; keep it that way — a scheduled job routed through
// here would be denied, because it has no authenticated user at all.
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

  // The org gate. A profile only authorizes against ITS OWN org; anything
  // else falls through to the membership-scoped branch 2 below rather than
  // being granted on role/tier alone. Note this is `===` on the profile's
  // own org, not "is a member of orgId" — a user who belongs to orgId via
  // organization_members but whose profile points at a different org is
  // still handled, by branch 2, using that org's membership role rather
  // than a role inherited from somewhere else.
  if (profile && profile.organization_id === orgId) {
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
  // owner or admin in the requested org, treat as owner. Already scoped by
  // orgId, so this branch was never part of the bypass above; reaching it
  // with a non-matching profile is the intended multi-org path.
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

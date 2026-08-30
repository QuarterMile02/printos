'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { ALL_ROLES, ALL_TIERS, type Role, type Tier } from '@/lib/permissions'

// Roles this form may assign. 'owner' is deliberately excluded: an org has
// one owner, it is a role-wide {'*': true} wildcard (permissions.ts), and
// minting a second one from an invite form is not a decision that belongs
// on this screen. Promote to owner deliberately, elsewhere.
const INVITABLE_ROLES: Role[] = ALL_ROLES.filter((r) => r !== 'owner')

// ── Why this action collects role AND tier ──────────────────────────────
// There are TWO role vocabularies in this schema and they are not
// interchangeable:
//
//   profiles.role            CHECK IN ('owner','sales','designer','production',
//                                      'installer','digital','accounting')
//                            -- migration 011:11. THIS is what hasPermission()
//                            evaluates. The real permission role.
//   organization_members.role  org_role enum ('owner','admin','member','viewer')
//                            -- migration 001:13. Legacy org-level access,
//                            read only by the owner/admin invite gate below.
//
// This form used to collect the SECOND one and call it "Role". That value
// cannot be written to profiles.role at all -- three of its five options
// ('admin','member','viewer') violate the CHECK constraint, and 'accountant'
// is not 'accounting'. Worse, two of them ('designer','accountant') are not
// even members of the org_role DB enum, so they failed on the invites insert
// too. The form now collects the permission role, which is the one that
// decides what the person can actually do.
//
// tier is a separate axis (staff/lead/manager) that upgrades a role's
// permissions -- see TIER_UPGRADES in permissions.ts. It has a DB default of
// 'staff' (migration 011:12), but defaulting silently would mean this form
// quietly decides someone's permission level, so it is an explicit field
// with 'staff' preselected.
//
// departments (profiles.departments, text[], DB default '{}') is NOT
// collected here. It is a multi-select against the departments table that
// belongs on the member detail panel, not in an invite dialog; new members
// land with none and get them assigned in Team settings. Left at the DB
// default rather than guessed.

export async function inviteMember(
  orgId: string,
  orgSlug: string,
  formData: FormData
): Promise<{ error?: string; email?: string }> {
  const email = (formData.get('email') as string | null)?.trim().toLowerCase()
  const fullName = (formData.get('full_name') as string | null)?.trim()
  const role = formData.get('role') as Role | null
  const tier = formData.get('tier') as Tier | null

  if (!email) return { error: 'Email is required.' }
  if (!fullName) return { error: 'Full name is required.' }
  if (!role || !INVITABLE_ROLES.includes(role)) return { error: 'Invalid role.' }
  if (!tier || !ALL_TIERS.includes(tier)) return { error: 'Invalid tier.' }

  // ── Authorize the caller against THIS org ────────────────────────────
  // Membership resolved from organization_members against the supplied
  // orgId -- the products/bulk-import-shopvox pattern. Deliberately not
  // checkPermission() alone: even with PR #57's org gate, checkPermission
  // answers "does this role hold this key", and what matters here is the
  // legacy org-level owner/admin grant that has always governed invites.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return { error: 'Only owners and admins can invite members.' }
  }

  const service = createServiceClient()

  // ── Reject an email that already has an account ───────────────────────
  // auth.admin.inviteUserByEmail() rejects a duplicate email itself, but
  // with a generic API error that would surface as a 500-ish blob. Check
  // first so the message is specific and the failure happens before
  // anything has been created.
  const { data: listed, error: listErr } = await service.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) return { error: 'Could not verify whether that email is already registered.' }
  const existing = listed?.users?.find((u) => u.email?.toLowerCase() === email)
  if (existing) {
    const alreadyMember = !!(await service
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('user_id', existing.id)
      .maybeSingle()).data
    return {
      error: alreadyMember
        ? 'That person is already a member of this organization.'
        : 'An account already exists for that email. It can\'t be invited again -- add them to this organization directly, or have them sign in and reset their password.',
    }
  }

  // ── Step 1: create the auth user and send Supabase's invite email ─────
  // No redirectTo: the link uses the project Site URL, matching
  // scripts/seed-qmi-team.mjs, so this works in every environment without
  // per-env configuration. The invited person sets their own password from
  // that email; we never see, generate, or store one.
  const { data: invited, error: inviteErr } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  })
  const userId = invited?.user?.id
  if (inviteErr || !userId) {
    // Never surface the raw admin-API error: it is the only place a token
    // or key could leak into a user-visible string.
    console.error('[inviteMember] inviteUserByEmail failed:', inviteErr?.message)
    return { error: 'Could not send the invitation. Check the email address and try again.' }
  }

  // ── Steps 2 and 3 are ALL OR NOTHING ──────────────────────────────────
  // A user with a profile but organization_id NULL and no membership row is
  // exactly the orphan PR #57's gate now denies everywhere -- and it would
  // look like a working account: real, confirmed, able to sign in, denied on
  // every page. That state must be unreachable from this button, so any
  // failure past this point deletes the auth user before returning.
  //
  // Deleting the auth user is a complete rollback, not a partial one:
  // profiles.id and organization_members.user_id both reference
  // auth.users(id) ON DELETE CASCADE (migration 001:22, 001:44), so the
  // profile row the on_auth_user_created trigger just made, plus any
  // membership written below, go with it.
  const rollback = async (stage: string, detail: string | undefined) => {
    console.error(`[inviteMember] ${stage} failed, rolling back auth user:`, detail)
    const { error: delErr } = await service.auth.admin.deleteUser(userId)
    if (delErr) {
      // Loud: the account exists but is unusable. Needs manual cleanup.
      console.error('[inviteMember] ROLLBACK FAILED -- orphan auth user left behind:', userId, delErr.message)
      return { error: 'Invite failed and could not be fully undone. Contact an administrator before retrying this email.' }
    }
    return { error: 'Could not finish setting up the account. Nothing was created; please try again.' }
  }

  // Step 2: profile. The on_auth_user_created trigger has already inserted
  // a baseline row (id, full_name, avatar_url), so this is an upsert that
  // fills in everything the trigger cannot know -- above all the org.
  const { error: profErr } = await service
    .from('profiles')
    .upsert({
      id: userId,
      full_name: fullName,
      role,
      tier,
      departments: [],
      organization_id: orgId,
      is_active: true,
    }, { onConflict: 'id' })
  if (profErr) return await rollback('profile upsert', profErr.message)

  // Step 3: membership. role is hardcoded 'member' on purpose, matching
  // scripts/seed-qmi-team.mjs. organization_members.role is the legacy
  // org-level access enum and is read by exactly one thing -- the
  // owner/admin gate above. The permission role lives on profiles.role.
  // Live data confirms the split is real and deliberate: 1 owner, 17
  // member, while profiles.role spans all seven values.
  const { error: memErr } = await service
    .from('organization_members')
    .upsert({
      organization_id: orgId,
      user_id: userId,
      role: 'member',
    }, { onConflict: 'organization_id,user_id' })
  if (memErr) return await rollback('membership upsert', memErr.message)

  // ── Step 4: the audit row, only now that the account really exists ─────
  // Written with status 'accepted', not 'pending'. By this line the account
  // IS provisioned -- there is no invitation outstanding on our side. The
  // only thing left is the person choosing a password, which rides on
  // Supabase's own invite token and has no representation in this table.
  // Leaving it 'pending' is what produced the permanent-pending display, so
  // the row records what happened and the Pending Invites list (which
  // filters status='pending') correctly shows nothing.
  //
  // organization_invites.role is the org_role enum, NOT profiles.role, so it
  // gets 'member' to match what was actually written to the membership row.
  // Non-fatal: the account is real and usable whether or not the audit row
  // lands, so a failure here is logged, not surfaced as a failed invite.
  const { error: auditErr } = await service
    .from('organization_invites')
    .insert({
      organization_id: orgId,
      email,
      role: 'member',
      status: 'accepted',
      invited_by: user.id,
    })
  if (auditErr) console.error('[inviteMember] audit row insert failed (account was created):', auditErr.message)

  revalidatePath(`/dashboard/${orgSlug}/settings/team`)
  return { email }
}

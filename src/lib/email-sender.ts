import type { SupabaseClient } from '@supabase/supabase-js'

// Reserved for automated/system-triggered notifications that aren't sent
// by a specific person (job-ready-for-pickup status emails, shipping
// tracking updates, and anything similar built later). User-initiated
// sends (a staff member composing/triggering a Quote email, etc.) must
// use getUserSenderIdentity() below instead -- never this constant.
export const SYSTEM_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'PrintOS <noreply@quartermileinc.com>'

// Resolves the Resend "from" header for an email a staff member is
// personally sending, to their own real identity -- their login email
// with their profile display name AND their org's name (e.g.
// "Ruben Reyes - Quarter Mile Inc <ruben@quartermileinc.com>").
//
// Safe without any extra Resend-side setup: once a domain is verified in
// Resend (SPF/DKIM), any address at that domain can send with no
// additional per-address configuration (confirmed against Resend's own
// docs, not assumed) -- and every org member's login email is on the
// verified quartermileinc.com domain (checked directly against
// organization_members/auth.users), so this always resolves to a
// sendable address today. Falls back to the email's local part if the
// user has no profile display name set, and drops the " - Org" suffix
// entirely if the org name lookup comes back empty -- never falls back to
// the system address, since that would silently misattribute a personal
// send.
export async function getUserSenderIdentity(
  service: SupabaseClient,
  userId: string,
  userEmail: string,
  orgId: string,
): Promise<string> {
  const [profileRes, orgRes] = await Promise.all([
    service.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    service.from('organizations').select('name').eq('id', orgId).maybeSingle(),
  ])
  const profile = profileRes.data as { full_name: string | null } | null
  const org = orgRes.data as { name: string | null } | null

  const displayName = profile?.full_name?.trim() || userEmail.split('@')[0]
  const orgName = org?.name?.trim()
  const identity = orgName ? `${displayName} - ${orgName}` : displayName
  return `${identity} <${userEmail}>`
}

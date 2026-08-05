import type { SupabaseClient } from '@supabase/supabase-js'

// Reserved for automated/system-triggered notifications that aren't sent
// by a specific person (job-ready-for-pickup status emails, shipping
// tracking updates, and anything similar built later). User-initiated
// sends (a staff member composing/triggering a Quote email, etc.) must
// use getUserSenderIdentity() below instead -- never this constant.
export const SYSTEM_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'PrintOS <noreply@quartermileinc.com>'

// Resolves the Resend "from" header for an email a staff member is
// personally sending, to their own real identity -- their login email
// with their profile display name (e.g. "Ruben Reyes <ruben@quartermileinc.com>").
//
// Safe without any extra Resend-side setup: once a domain is verified in
// Resend (SPF/DKIM), any address at that domain can send with no
// additional per-address configuration (confirmed against Resend's own
// docs, not assumed) -- and every org member's login email is on the
// verified quartermileinc.com domain (checked directly against
// organization_members/auth.users), so this always resolves to a
// sendable address today. Falls back to the email's local part if the
// user has no profile display name set, and to the bare email if even
// that lookup fails -- never falls back to the system address, since
// that would silently misattribute a personal send.
export async function getUserSenderIdentity(
  service: SupabaseClient,
  userId: string,
  userEmail: string,
): Promise<string> {
  const { data } = await service
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle() as { data: { full_name: string | null } | null }

  const displayName = data?.full_name?.trim() || userEmail.split('@')[0]
  return `${displayName} <${userEmail}>`
}

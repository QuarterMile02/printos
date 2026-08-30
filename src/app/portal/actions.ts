'use server'

// Customer Portal auth actions (build plan rev. 2, step 3).
//
// createClient() (cookie-bound, anon key) does the actual sign-in/sign-out —
// same client staff auth already uses (see (auth)/login/page.tsx) — so
// session cookies get set/cleared correctly from inside a Server Action.
// createServiceClient() is used ONLY to read/write customer_contacts, since
// no RLS policy lets a portal contact read their own row yet (that's step 6
// -- deliberately deferred, see migration 134/135 comments). Every
// service-client query here is scoped by a value that came from the
// session's own auth.getUser() / a single-use invite token, never from
// unvalidated client input.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const MIN_PASSWORD_LENGTH = 8

export async function portalSignIn(formData: FormData): Promise<void> {
  const email = (formData.get('email') as string | null)?.trim().toLowerCase()
  const password = formData.get('password') as string | null
  if (!email || !password) redirect('/portal/login?error=' + encodeURIComponent('Email and password are required.'))

  const supabase = await createClient()
  const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
  if (signInErr || !signInData.user) {
    redirect('/portal/login?error=' + encodeURIComponent(signInErr?.message ?? 'Invalid email or password.'))
  }

  // Confirm this login is actually a portal contact, not a staff account (or
  // any other auth.users row) that happened to sign in successfully here.
  const service = createServiceClient()
  const { count } = await service
    .from('customer_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('portal_user_id', signInData.user.id)

  if (!count) {
    await supabase.auth.signOut()
    redirect('/portal/login?error=' + encodeURIComponent('This login is not associated with a Customer Portal account.'))
  }

  await service
    .from('customer_contacts')
    .update({ portal_last_login_at: new Date().toISOString() })
    .eq('portal_user_id', signInData.user.id)

  redirect('/portal')
}

export async function portalSignOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/portal/login')
}

export async function acceptInvite(
  token: string,
  password: string,
  confirmPassword: string,
): Promise<{ error?: string }> {
  if (!token) return { error: 'Missing invite token.' }
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  if (password !== confirmPassword) return { error: 'Passwords do not match.' }

  const service = createServiceClient()

  const { data: contact, error: lookupErr } = await service
    .from('customer_contacts')
    .select('id, email, full_name, portal_user_id, portal_invite_expires_at')
    .eq('portal_invite_token', token)
    .maybeSingle() as {
      data: { id: string; email: string | null; full_name: string; portal_user_id: string | null; portal_invite_expires_at: string | null } | null
      error: unknown
    }
  if (lookupErr) return { error: (lookupErr as { message: string }).message }
  if (!contact) return { error: 'Invalid or expired invite link.' }
  if (contact.portal_user_id) return { error: 'This invite has already been used. Try signing in instead.' }
  if (!contact.email) return { error: 'This contact has no email on file — contact QMI staff.' }
  if (!contact.portal_invite_expires_at || new Date(contact.portal_invite_expires_at) < new Date()) {
    return { error: 'This invite link has expired. Ask QMI staff to resend it.' }
  }

  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email: contact.email,
    password,
    email_confirm: true,
  })
  if (createErr || !created.user) return { error: createErr?.message ?? 'Could not create account.' }

  const { error: linkErr } = await service
    .from('customer_contacts')
    .update({
      portal_user_id: created.user.id,
      portal_invite_token: null,
      portal_invite_expires_at: null,
      portal_last_login_at: new Date().toISOString(),
    })
    .eq('id', contact.id)
  if (linkErr) return { error: linkErr.message }

  // Establish the session (createUser via the admin API does not itself sign
  // the browser in) — same client staff login uses, so cookies get set here.
  const supabase = await createClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email: contact.email, password })
  if (signInErr) return { error: 'Account created — please sign in.' }

  redirect('/portal')
}

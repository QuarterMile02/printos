import { createServiceClient } from '@/lib/supabase/server'
import AcceptInviteForm from './accept-invite-form'

type PageProps = { searchParams: Promise<{ token?: string }> }

// Server-side pre-check purely for UX (show "invalid/expired" without even
// rendering the form) -- NOT the security boundary. acceptInvite() itself
// re-validates the token, expiry, and portal_user_id state from scratch on
// submit, so there's no duplicated trust here: this page can be wrong/stale
// and nothing bad happens, the real action still checks everything again.
export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const { token } = await searchParams

  let contact: { full_name: string; email: string | null } | null = null
  let error: string | null = null

  if (!token) {
    error = 'Missing invite link.'
  } else {
    const service = createServiceClient()
    const { data } = await service
      .from('customer_contacts')
      .select('full_name, email, portal_user_id, portal_invite_expires_at')
      .eq('portal_invite_token', token)
      .maybeSingle() as {
        data: { full_name: string; email: string | null; portal_user_id: string | null; portal_invite_expires_at: string | null } | null
      }

    if (!data) error = 'This invite link is invalid.'
    else if (data.portal_user_id) error = 'This invite has already been used — try signing in instead.'
    else if (!data.portal_invite_expires_at || new Date(data.portal_invite_expires_at) < new Date()) error = 'This invite link has expired. Ask QMI staff to resend it.'
    else contact = { full_name: data.full_name, email: data.email }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-qm-surface">
      <div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 shadow-sm border border-gray-200">
        <div>
          <h1 className="text-2xl font-extrabold uppercase text-qm-black">Customer <span className="text-qm-lime">Portal</span></h1>
          <p className="mt-1 text-sm text-qm-gray">Set up your account</p>
        </div>

        {error ? (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">{error}</div>
        ) : contact ? (
          <>
            <p className="text-sm text-qm-gray">
              Welcome, <span className="font-semibold text-qm-black">{contact.full_name}</span>. Set a password for <span className="font-mono">{contact.email}</span> to finish setting up your account.
            </p>
            <AcceptInviteForm token={token!} />
          </>
        ) : null}

        <p className="text-center text-xs text-qm-gray">
          Already have an account? <a href="/portal/login" className="font-semibold text-qm-lime hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}

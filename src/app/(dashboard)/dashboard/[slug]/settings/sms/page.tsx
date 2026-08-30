import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import SmsClient, { type Props as ClientProps } from './sms-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('sms-settings', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="p-8 text-red-600">Not authenticated</div>

  const memberRow = await dbOrThrow(
    supabase
      .from('organization_members').select('role')
      .eq('organization_id', org.id).eq('user_id', user.id).maybeSingle()
  ) as { role: string } | null

  const isOwnerOrAdmin = memberRow?.role === 'owner' || memberRow?.role === 'admin'
  if (!isOwnerOrAdmin) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">SMS</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Only owners and admins can manage SMS settings. Contact your organization owner.
        </div>
      </div>
    )
  }

  let settingsRow: {
    twilio_phone_number?: string | null
    country_code?: string
    is_connected?: boolean
    hasTwilioAccountSid?: boolean
    hasTwilioAuthToken?: boolean
  } | null = null
  let templates: unknown[] = []

  try {
    const { data } = await supabase.from('sms_settings').select('*').eq('organization_id', org.id).maybeSingle()
    const row = data as { twilio_account_sid?: string | null; twilio_auth_token?: string | null; twilio_phone_number?: string | null; country_code?: string; is_connected?: boolean } | null
    // Never send the decrypted (or even encrypted) credential values to the browser --
    // only whether each one already has a saved value, so the form can render a masked
    // placeholder instead of the real secret.
    if (row) {
      settingsRow = {
        twilio_phone_number: row.twilio_phone_number,
        country_code: row.country_code,
        is_connected: row.is_connected,
        hasTwilioAccountSid: Boolean(row.twilio_account_sid),
        hasTwilioAuthToken: Boolean(row.twilio_auth_token),
      }
    }
  } catch {}
  try { const { data } = await supabase.from('sms_templates').select('*').eq('organization_id', org.id).order('sort_order'); templates = data ?? [] } catch {}

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">SMS</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">SMS</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure Twilio for automated SMS and manage reusable message templates.
        </p>
      </div>

      <SmsClient
        orgId={org.id}
        orgSlug={slug}
        initialSettings={(settingsRow ?? {}) as ClientProps['initialSettings']}
        initialTemplates={(templates ?? []) as ClientProps['initialTemplates']}
      />
    </div>
  )
}

import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow } from '@/lib/db'
import SmsClient, { type Props as ClientProps } from './sms-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sms-settings] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (SMS settings)</h1>
        <div>{message}</div>
      </div>
    )
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

  const { data: memberRow } = await supabase
    .from('organization_members').select('role')
    .eq('organization_id', org.id).eq('user_id', user.id).maybeSingle() as { data: { role: string } | null; error: unknown }

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

  let settingsRow = null
  let templates: unknown[] = []

  try { const { data } = await supabase.from('sms_settings').select('*').eq('organization_id', org.id).maybeSingle(); settingsRow = data } catch {}
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

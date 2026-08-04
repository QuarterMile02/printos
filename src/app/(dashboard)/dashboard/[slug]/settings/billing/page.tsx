import { createClient, createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import AccountClient, { type Props as ClientProps, type DayHours } from './billing-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('account-settings', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()
  const service = createServiceClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="p-8 text-red-600">Not authenticated</div>

  const memberRow = await dbOrThrow(
    supabase.from('organization_members').select('role')
      .eq('organization_id', org.id).eq('user_id', user.id).maybeSingle()
  ) as { role: string } | null

  const isOwnerOrAdmin = memberRow?.role === 'owner' || memberRow?.role === 'admin'
  if (!isOwnerOrAdmin) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-900">Account</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Only owners and admins can manage account and company profile settings. Contact your organization owner.
        </div>
      </div>
    )
  }

  let profileRow = null
  try {
    const { data } = await supabase.from('org_profile').select('*').eq('organization_id', org.id).maybeSingle()
    profileRow = data
  } catch { /* table may not exist yet */ }

  let businessHours: DayHours[] = []
  try {
    const { data } = await service
      .from('business_hours')
      .select('day_of_week, is_open, open_time, close_time')
      .eq('organization_id', org.id)
      .order('day_of_week')
    businessHours = (data ?? []) as DayHours[]
  } catch { /* table not applied yet */ }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Account</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Company profile, logo, regional preferences, and plan details.
        </p>
      </div>

      <AccountClient
        orgId={org.id}
        orgSlug={slug}
        orgName={org.name}
        initialProfile={(profileRow ?? {}) as ClientProps['initialProfile']}
        initialHours={businessHours}
      />
    </div>
  )
}

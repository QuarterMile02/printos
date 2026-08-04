import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveShippingProfile } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import ShippingProfilesListClient, { type ProfileRow } from './shipping-profiles-list-client'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; error?: string }>
}

export default async function Page(props: PageProps) {
  try { return await PageInner(props) } catch (err) {
    return renderPageError('shipping-profiles-settings', err)
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { allowed } = await checkPermission(org.id, 'settings.shipping_profiles')
  if (!allowed) return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Shipping Profiles</h1>
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        You don&apos;t have permission to manage shipping profiles.
      </div>
    </div>
  )

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  type MemberRow = { user_id: string; role: string }
  const memberRows = await dbOrThrow(
    supabase
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', org.id)
  ) as MemberRow[] | null
  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const data = await dbOrThrow(
    supabase
      .from('shipping_profiles').select('id, name, length_in, width_in, height_in, max_weight_lbs, is_active')
      .eq('organization_id', org.id).order('name', { ascending: true })
  )
  const profiles = (data ?? []) as ProfileRow[]

  const editId = sp.edit
  const showAdd = sp.add === '1'
  let editProfile: ProfileRow | null = profiles.find(p => p.id === editId) ?? null
  if (editId && !editProfile) {
    const f = await dbOrThrow(
      supabase.from('shipping_profiles')
        .select('id, name, length_in, width_in, height_in, max_weight_lbs, is_active')
        .eq('id', editId).eq('organization_id', org.id).maybeSingle()
    )
    editProfile = (f as ProfileRow | null)
  }

  const panelOpen = Boolean(editProfile || showAdd)
  const inp = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const lbl = 'block text-xs font-medium text-gray-500'

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span><span className="text-gray-700">Shipping Profiles</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold text-qm-black">
          Shipping Profiles <span className="text-sm font-normal text-gray-400">({profiles.length})</span>
        </h1>
        <Link
          href={`/dashboard/${slug}/settings/shipping-profiles?add=1`}
          className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          + New Profile
        </Link>
      </div>

      {panelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
            </div>
          )}
          {sp.error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {decodeURIComponent(sp.error)}
            </div>
          )}
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">
            {editProfile ? 'Edit Profile' : 'New Shipping Profile'}
          </h2>
          <form action={saveShippingProfile} className="space-y-4">
            {editProfile && <input type="hidden" name="id" value={editProfile.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />

            <div>
              <label className={lbl}>Name *</label>
              <input type="text" name="name" required defaultValue={editProfile?.name ?? ''} placeholder="e.g. Small Package" className={inp} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className={lbl}>Length (in)</label>
                <input type="number" step="0.01" min="0" name="length_in" defaultValue={editProfile?.length_in ?? ''} className={inp} />
              </div>
              <div>
                <label className={lbl}>Width (in)</label>
                <input type="number" step="0.01" min="0" name="width_in" defaultValue={editProfile?.width_in ?? ''} className={inp} />
              </div>
              <div>
                <label className={lbl}>Height (in)</label>
                <input type="number" step="0.01" min="0" name="height_in" defaultValue={editProfile?.height_in ?? ''} className={inp} />
              </div>
              <div>
                <label className={lbl}>Max Weight (lbs)</label>
                <input type="number" step="0.01" min="0" name="max_weight_lbs" defaultValue={editProfile?.max_weight_lbs ?? ''} className={inp} />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="is_active" defaultChecked={editProfile?.is_active !== false} className="h-4 w-4 accent-qm-lime" />
              <span className="text-sm text-gray-700">Active</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save</button>
              <Link href={`/dashboard/${slug}/settings/shipping-profiles`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
            </div>
          </form>
        </div>
      )}

      <ShippingProfilesListClient profiles={profiles} orgSlug={slug} orgId={org.id} userId={userId} userRole={userRole} />

      <p className="mt-3 text-xs text-gray-400">
        Profiles define common box sizes. Selecting one on a shipment auto-fills the dimensions.
      </p>
    </div>
  )
}

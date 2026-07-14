import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveShippingProfile } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'

export const dynamic = 'force-dynamic'

type Profile = {
  id: string
  name: string
  length_in: number | null
  width_in: number | null
  height_in: number | null
  max_weight_lbs: number | null
  is_active: boolean
}

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; sort?: string }>
}

function dims(p: Profile): string {
  const parts = [p.length_in, p.width_in, p.height_in]
  if (parts.every(v => v == null)) return '—'
  return parts.map(v => v ?? '?').join(' × ') + '"'
}

export default async function Page(props: PageProps) {
  try { return await PageInner(props) } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace' }}><b>PAGE ERROR</b><br />{msg}</div>
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const sortDesc = sp.sort === 'desc'
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
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

  const { data } = await supabase
    .from('shipping_profiles').select('id, name, length_in, width_in, height_in, max_weight_lbs, is_active')
    .eq('organization_id', org.id).order('name', { ascending: !sortDesc })
  const profiles = (data ?? []) as Profile[]

  const editId = sp.edit
  const showAdd = sp.add === '1'
  let editProfile: Profile | null = profiles.find(p => p.id === editId) ?? null
  if (editId && !editProfile) {
    const { data: f } = await supabase.from('shipping_profiles')
      .select('id, name, length_in, width_in, height_in, max_weight_lbs, is_active')
      .eq('id', editId).eq('organization_id', org.id).single()
    editProfile = (f as Profile | null)
  }

  const panelOpen = Boolean(editProfile || showAdd)
  const inp = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const lbl = 'block text-xs font-medium text-gray-500'

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span><span className="text-gray-700">Shipping Profiles</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Shipping Profiles <span className="text-sm font-normal text-gray-400">({profiles.length})</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/${slug}/settings/shipping-profiles${sortDesc ? '' : '?sort=desc'}`}
            className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${!sortDesc ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            {sortDesc ? 'Z-A ↓' : 'A-Z ↑'}
          </Link>
          <Link
            href={`/dashboard/${slug}/settings/shipping-profiles?add=1`}
            className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            + New Profile
          </Link>
        </div>
      </div>

      {panelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
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

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Dimensions (L×W×H)</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Max Weight</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {profiles.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No shipping profiles yet.</td></tr>
            ) : profiles.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/${slug}/settings/shipping-profiles?edit=${p.id}`} className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia">
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 font-mono">{dims(p)}</td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {p.max_weight_lbs != null ? `${p.max_weight_lbs} lbs` : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block h-2 w-2 rounded-full ${p.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/dashboard/${slug}/settings/shipping-profiles?edit=${p.id}`} className="text-sm text-qm-lime hover:underline">Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Profiles define common box sizes. Selecting one on a shipment auto-fills the dimensions.
      </p>
    </div>
  )
}

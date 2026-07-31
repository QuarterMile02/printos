import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveShippingMethod } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'

export const dynamic = 'force-dynamic'

const CARRIERS = [
  { value: 'fedex',     label: 'FedEx'    },
  { value: 'ups',       label: 'UPS'      },
  { value: 'usps',      label: 'USPS'     },
  { value: 'easypost',  label: 'EasyPost' },
  { value: 'local',     label: 'Local'    },
  { value: 'pickup',    label: 'Pickup'   },
  { value: 'other',     label: 'Other'    },
]

const CARRIER_BADGE: Record<string, string> = {
  fedex:    'bg-purple-50 text-purple-700',
  ups:      'bg-amber-50  text-amber-800',
  usps:     'bg-blue-50   text-blue-700',
  easypost: 'bg-indigo-50 text-indigo-700',
  local:    'bg-green-50  text-green-700',
  pickup:   'bg-teal-50   text-teal-700',
  other:    'bg-gray-100  text-gray-600',
}

const CARRIER_LABEL: Record<string, string> = {
  fedex: 'FedEx', ups: 'UPS', usps: 'USPS', easypost: 'EasyPost',
  local: 'Local', pickup: 'Pickup', other: 'Other',
}

type Method = { id: string; name: string; carrier: string | null; is_active: boolean }

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; sort?: string; search?: string; carrier?: string }>
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

  const { allowed } = await checkPermission(org.id, 'settings.shipping_methods')
  if (!allowed) return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Shipping Methods</h1>
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        You don&apos;t have permission to manage shipping methods.
      </div>
    </div>
  )

  const { data } = await supabase
    .from('shipping_methods').select('id, name, carrier, is_active')
    .eq('organization_id', org.id).order('name', { ascending: !sortDesc })
  const allMethods = (data ?? []) as Method[]
  const search = (sp.search ?? '').trim().toLowerCase()
  const carrierFilter = sp.carrier ?? ''
  let methods = allMethods
  if (search) methods = methods.filter(m => m.name.toLowerCase().includes(search))
  if (carrierFilter) methods = methods.filter(m => m.carrier === carrierFilter)

  const editId = sp.edit
  const showAdd = sp.add === '1'
  let editMethod: Method | null = allMethods.find(m => m.id === editId) ?? null
  if (editId && !editMethod) {
    const { data: f } = await supabase.from('shipping_methods').select('id, name, carrier, is_active')
      .eq('id', editId).eq('organization_id', org.id).single()
    editMethod = (f as Method | null)
  }

  const panelOpen = Boolean(editMethod || showAdd)
  const inp = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const lbl = 'block text-xs font-medium text-gray-500'

  function buildUrl(overrides: { sort?: string; add?: string } = {}) {
    const p = new URLSearchParams()
    const sort = 'sort' in overrides ? overrides.sort : (sortDesc ? 'desc' : '')
    if (sort) p.set('sort', sort)
    if (sp.search) p.set('search', sp.search)
    if (carrierFilter) p.set('carrier', carrierFilter)
    if (overrides.add) p.set('add', overrides.add)
    const qs = p.toString()
    return `/dashboard/${slug}/settings/shipping-methods${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span><span className="text-gray-700">Shipping Methods</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold text-qm-black">
          Shipping Methods <span className="text-sm font-normal text-gray-400">({methods.length})</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={buildUrl({ sort: sortDesc ? '' : 'desc' })}
            className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${!sortDesc ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            {sortDesc ? 'Z-A ↓' : 'A-Z ↑'}
          </Link>
          <Link
            href={buildUrl({ add: '1' })}
            className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            + New Method
          </Link>
        </div>
      </div>

      {/* Search + carrier filter */}
      <form className="mb-4 flex flex-wrap gap-3">
        {sortDesc && <input type="hidden" name="sort" value="desc" />}
        <input
          type="text"
          name="search"
          defaultValue={sp.search ?? ''}
          placeholder="Search by name..."
          className="block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
        <select
          name="carrier"
          defaultValue={carrierFilter}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="">All Carriers</option>
          {CARRIERS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
          Filter
        </button>
      </form>

      {panelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
            </div>
          )}
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">
            {editMethod ? 'Edit Method' : 'New Shipping Method'}
          </h2>
          <form action={saveShippingMethod} className="space-y-4">
            {editMethod && <input type="hidden" name="id" value={editMethod.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Name *</label>
                <input type="text" name="name" required defaultValue={editMethod?.name ?? ''} placeholder="e.g. FedEx Ground" className={inp} />
              </div>
              <div>
                <label className={lbl}>Carrier</label>
                <select name="carrier" defaultValue={editMethod?.carrier ?? ''} className={inp}>
                  <option value="">— None —</option>
                  {CARRIERS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="is_active" defaultChecked={editMethod?.is_active !== false} className="h-4 w-4 accent-qm-lime" />
              <span className="text-sm text-gray-700">Active</span>
            </label>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save</button>
              <Link href={`/dashboard/${slug}/settings/shipping-methods`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Carrier</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
              <th className={`px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 ${STICKY_ACTIONS_TH}`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {methods.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">
                {search || carrierFilter ? 'No shipping methods match the current filters.' : 'No shipping methods yet.'}
              </td></tr>
            ) : methods.map(m => (
              <tr key={m.id} className="group hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/${slug}/settings/shipping-methods?edit=${m.id}`} className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia">
                    {m.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {m.carrier
                    ? <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${CARRIER_BADGE[m.carrier] ?? 'bg-gray-100 text-gray-600'}`}>
                        {CARRIER_LABEL[m.carrier] ?? m.carrier}
                      </span>
                    : <span className="text-gray-300 text-sm">—</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block h-2 w-2 rounded-full ${m.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                </td>
                <td className={`px-4 py-3 text-right ${STICKY_ACTIONS_TD}`}>
                  <Link href={`/dashboard/${slug}/settings/shipping-methods?edit=${m.id}`} className="text-sm text-qm-lime hover:underline">Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

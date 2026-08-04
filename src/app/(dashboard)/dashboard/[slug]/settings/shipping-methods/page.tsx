import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveShippingMethod } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import ShippingMethodsListClient, { type MethodRow } from './shipping-methods-list-client'

export const dynamic = 'force-dynamic'

const CARRIERS = [
  { value: 'fedex',     label: 'FedEx'    },
  { value: 'ups',       label: 'UPS'      },
  { value: 'usps',      label: 'USPS'     },
  { value: 'easypost',  label: 'EasyPost' },
  { value: 'local',     label: 'Local'    },
  { value: 'pickup',    label: 'Pickup'   },
  { value: 'freight',   label: 'Freight'  },
  { value: 'other',     label: 'Other'    },
]

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; error?: string }>
}

export default async function Page(props: PageProps) {
  try { return await PageInner(props) } catch (err) {
    return renderPageError('shipping-methods-settings', err)
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

  const { allowed } = await checkPermission(org.id, 'settings.shipping_methods')
  if (!allowed) return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Shipping Methods</h1>
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        You don&apos;t have permission to manage shipping methods.
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
      .from('shipping_methods').select('id, name, carrier, is_active')
      .eq('organization_id', org.id).order('name', { ascending: true })
  )
  const methods = (data ?? []) as MethodRow[]

  const editId = sp.edit
  const showAdd = sp.add === '1'
  let editMethod: MethodRow | null = methods.find(m => m.id === editId) ?? null
  if (editId && !editMethod) {
    const f = await dbOrThrow(
      supabase.from('shipping_methods').select('id, name, carrier, is_active')
        .eq('id', editId).eq('organization_id', org.id).maybeSingle()
    )
    editMethod = (f as MethodRow | null)
  }

  const panelOpen = Boolean(editMethod || showAdd)
  const inp = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const lbl = 'block text-xs font-medium text-gray-500'

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
        <Link
          href={`/dashboard/${slug}/settings/shipping-methods?add=1`}
          className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          + New Method
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

      <ShippingMethodsListClient methods={methods} orgSlug={slug} orgId={org.id} userId={userId} userRole={userRole} />
    </div>
  )
}

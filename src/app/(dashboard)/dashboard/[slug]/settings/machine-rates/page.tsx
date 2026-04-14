import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveMachineRate, cloneMachineRate } from './actions-sr'

export const dynamic = 'force-dynamic'

const FORMULAS = ['Area', 'Perimeter', 'Width', 'Height', 'Unit', 'Fixed Qty']
const UNITS = ['Hr', 'Each', 'Sqft', 'Feet', 'Inch', 'Yard', 'Roll', 'Sheet']

type Rate = { id: string; name: string; external_name: string | null; cost: number | null; price: number | null; markup: number | null; formula: string | null; units: string | null; production_rate: number | null; production_rate_units: string | null; setup_charge: number | null; labor_charge: number | null; other_charge: number | null; include_in_base_price: boolean | null; description: string | null; show_internal: boolean | null; display_name_in_line_item: boolean | null; active: boolean | null }

export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ search?: string; formula?: string; status?: string; edit?: string; add?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: rows } = await supabase
    .from('machine_rates')
    .select('id, name, external_name, cost, price, markup, formula, units, production_rate, production_rate_units, setup_charge, labor_charge, other_charge, include_in_base_price, description, show_internal, display_name_in_line_item, active')
    .eq('organization_id', org.id)
    .order('name')
  let rates = (rows ?? []) as Rate[]

  const search = sp.search?.trim().toLowerCase() ?? ''
  if (search) rates = rates.filter(r => r.name.toLowerCase().includes(search))
  if (sp.formula) rates = rates.filter(r => r.formula === sp.formula)
  if (sp.status === 'active') rates = rates.filter(r => r.active !== false)
  if (sp.status === 'inactive') rates = rates.filter(r => r.active === false)

  const editId = sp.edit
  const showAdd = sp.add === '1'
  const editRate = editId ? rates.find(r => r.id === editId) ?? null : null

  let usedInCount = 0
  let usedInProducts: { id: string; name: string }[] = []
  if (editRate) {
    const { data: used } = await supabase.from('product_default_items').select('product_id').eq('machine_rate_id', editRate.id)
    const productIds = [...new Set(((used ?? []) as { product_id: string }[]).map(u => u.product_id))]
    usedInCount = productIds.length
    if (productIds.length > 0) {
      const { data: prods } = await supabase.from('products').select('id, name').in('id', productIds)
      usedInProducts = (prods ?? []) as { id: string; name: string }[]
    }
  }

  const n = (v: number | null | undefined, d = 0) => Number(v ?? d)

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Machine Rates</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Machine Rates <span className="text-sm font-normal text-gray-400">({rates.length})</span></h1>
        <div className="flex gap-2">
          <Link href={`/dashboard/${slug}/settings/machine-rates/import`} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Import CSV</Link>
          <Link href={`/dashboard/${slug}/settings/machine-rates?add=1`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">+ New Rate</Link>
        </div>
      </div>

      <form className="mb-4 flex flex-wrap gap-3">
        <input type="text" name="search" defaultValue={search} placeholder="Search by name..." className="rounded-md border border-gray-300 px-3 py-2 text-sm w-64 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
        <select name="formula" defaultValue={sp.formula ?? ''} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none">
          <option value="">All Formulas</option>{FORMULAS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none">
          <option value="">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Filter</button>
      </form>

      {(showAdd || editRate) && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">{editRate ? 'Edit Rate' : 'New Machine Rate'}</h2>
          <form action={saveMachineRate}>
            {editRate && <input type="hidden" name="id" value={editRate.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div><label className="block text-xs font-medium text-gray-500">Name *</label><input type="text" name="name" required defaultValue={editRate?.name ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" /></div>
              <div><label className="block text-xs font-medium text-gray-500">External Name</label><input type="text" name="external_name" defaultValue={editRate?.external_name ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" /></div>
              <div><label className="block text-xs font-medium text-gray-500">Cost ($)</label><input type="number" name="cost" step="0.01" defaultValue={n(editRate?.cost).toFixed(2)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" /></div>
              <div><label className="block text-xs font-medium text-gray-500">Price ($)</label><input type="number" name="price" step="0.01" defaultValue={n(editRate?.price).toFixed(2)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" /></div>
              <div><label className="block text-xs font-medium text-gray-500">Formula</label><select name="formula" defaultValue={editRate?.formula ?? 'Area'} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none">{FORMULAS.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
              <div><label className="block text-xs font-medium text-gray-500">Units</label><select name="units" defaultValue={editRate?.units ?? 'Sqft'} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none">{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
              <div><label className="block text-xs font-medium text-gray-500">Setup Charge</label><input type="number" name="setup_charge" step="0.01" defaultValue={n(editRate?.setup_charge).toFixed(2)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" /></div>
              <div><label className="block text-xs font-medium text-gray-500">Labor Charge</label><input type="number" name="labor_charge" step="0.01" defaultValue={n(editRate?.labor_charge).toFixed(2)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" /></div>
              <div><label className="block text-xs font-medium text-gray-500">Other Charge</label><input type="number" name="other_charge" step="0.01" defaultValue={n(editRate?.other_charge).toFixed(2)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" /></div>
              <div><label className="block text-xs font-medium text-gray-500">Production Rate</label><input type="number" name="production_rate" step="0.01" defaultValue={editRate?.production_rate ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" /></div>
              <div><label className="block text-xs font-medium text-gray-500">Prod. Rate Units</label><input type="text" name="production_rate_units" defaultValue={editRate?.production_rate_units ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" /></div>
              <div className="flex items-end gap-4 pb-1">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" name="include_in_base_price" defaultChecked={editRate?.include_in_base_price === true} className="h-4 w-4 accent-qm-lime" />In Base</label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" name="show_internal" defaultChecked={editRate?.show_internal !== false} className="h-4 w-4 accent-qm-lime" />Internal</label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" name="active" defaultChecked={editRate?.active !== false} className="h-4 w-4 accent-qm-lime" />Active</label>
              </div>
            </div>
            <div className="mb-4"><label className="block text-xs font-medium text-gray-500">Notes</label><textarea name="description" rows={2} defaultValue={editRate?.description ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" /></div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save</button>
              <Link href={`/dashboard/${slug}/settings/machine-rates`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
              {editRate && (
                <>
                  <form action={cloneMachineRate} className="inline"><input type="hidden" name="sourceId" value={editRate.id} /><input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="orgSlug" value={slug} /><input type="hidden" name="targetTable" value="machine_rates" /><button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">Clone as Machine</button></form>
                  <form action={cloneMachineRate} className="inline"><input type="hidden" name="sourceId" value={editRate.id} /><input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="orgSlug" value={slug} /><input type="hidden" name="targetTable" value="labor_rates" /><button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">Clone as Labor</button></form>
                </>
              )}
            </div>
          </form>
          {editRate && (
            <div className="mt-6 border-t border-gray-200 pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Used In ({usedInCount} product{usedInCount === 1 ? '' : 's'})</h3>
              {usedInProducts.length > 0 ? (
                <div className="flex flex-wrap gap-2">{usedInProducts.map(p => (<Link key={p.id} href={`/dashboard/${slug}/products/${p.id}`} className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200">{p.name}</Link>))}</div>
              ) : <p className="text-xs text-gray-400">Not used in any products.</p>}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Ext. Name</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Cost</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Price</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Markup</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Formula</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Units</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Prod. Rate</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rates.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">No machine rates{search ? ` matching "${search}"` : ''}.</td></tr>
            ) : rates.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3"><Link href={`/dashboard/${slug}/settings/machine-rates?edit=${r.id}`} className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia">{r.name}</Link></td>
                <td className="px-4 py-3 text-sm text-gray-500">{r.external_name ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">${n(r.cost).toFixed(2)}</td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">${n(r.price).toFixed(2)}</td>
                <td className="px-4 py-3 text-sm text-gray-600 text-right tabular-nums">{n(r.markup, 1).toFixed(2)}x</td>
                <td className="px-4 py-3 text-sm text-gray-600">{r.formula ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{r.units ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600 text-right tabular-nums">{r.production_rate != null ? n(r.production_rate) : '—'}</td>
                <td className="px-4 py-3 text-center"><span className={`inline-block h-2 w-2 rounded-full ${r.active !== false ? 'bg-green-500' : 'bg-gray-300'}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

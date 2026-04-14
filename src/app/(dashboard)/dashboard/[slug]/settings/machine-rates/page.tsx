import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveMachineRate, deleteMachineRate } from './actions-sr'

export const dynamic = 'force-dynamic'

export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ add?: string; edit?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: rows } = await supabase
    .from('machine_rates')
    .select('id, name, cost, price, markup, formula, units, active')
    .eq('organization_id', org.id)
    .order('name')
  const rates = (rows ?? []) as { id: string; name: string; cost: number | null; price: number | null; markup: number | null; formula: string | null; units: string | null; active: boolean | null }[]

  const editingId = sp.edit
  const showAdd = sp.add === '1'
  const editingRate = editingId ? rates.find(r => r.id === editingId) : null

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Machine Rates</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Machine Rates</h1>
        <Link href={`/dashboard/${slug}/settings/machine-rates?add=1`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
          + New Machine Rate
        </Link>
      </div>

      {(showAdd || editingRate) && (
        <RateForm rate={editingRate ?? null} orgId={org.id} orgSlug={slug} />
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Cost/hr</th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Price/hr</th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Markup</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Formula</th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rates.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-400">No machine rates yet.</td></tr>
            ) : rates.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-6 py-3">
                  <Link href={`/dashboard/${slug}/settings/machine-rates?edit=${r.id}`} className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia">
                    {r.name}
                  </Link>
                </td>
                <td className="px-6 py-3 text-sm text-gray-900 text-right tabular-nums">${Number(r.cost ?? 0).toFixed(2)}</td>
                <td className="px-6 py-3 text-sm text-gray-900 text-right tabular-nums">${Number(r.price ?? 0).toFixed(2)}</td>
                <td className="px-6 py-3 text-sm text-gray-600 text-right tabular-nums">{Number(r.markup ?? 1).toFixed(2)}x</td>
                <td className="px-6 py-3 text-sm text-gray-600">{r.formula ?? '—'}</td>
                <td className="px-6 py-3 text-center">
                  <span className={`inline-block h-2 w-2 rounded-full ${r.active ? 'bg-green-500' : 'bg-gray-300'}`} />
                </td>
                <td className="px-6 py-3 text-right">
                  <form action={deleteMachineRate} className="inline">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="orgSlug" value={slug} />
                    <button type="submit" className="text-xs text-red-500 hover:text-red-700">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RateForm({ rate, orgId, orgSlug }: { rate: { id: string; name: string; cost: number | null; price: number | null; formula: string | null; units: string | null; active: boolean | null } | null; orgId: string; orgSlug: string }) {
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">{rate ? 'Edit Machine Rate' : 'New Machine Rate'}</h2>
      <form action={saveMachineRate}>
        {rate && <input type="hidden" name="id" value={rate.id} />}
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input type="text" name="name" required defaultValue={rate?.name ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Cost/hr ($)</label>
            <input type="number" name="cost" step="0.01" min="0" defaultValue={Number(rate?.cost ?? 0).toFixed(2)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Price/hr ($)</label>
            <input type="number" name="price" step="0.01" min="0" defaultValue={Number(rate?.price ?? 0).toFixed(2)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Formula</label>
            <select name="formula" defaultValue={rate?.formula ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime">
              <option value="">—</option>
              <option value="Area">Area</option>
              <option value="Perimeter">Perimeter</option>
              <option value="Width">Width</option>
              <option value="Height">Height</option>
              <option value="Unit">Unit</option>
              <option value="Fixed Qty">Fixed Qty</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Units</label>
            <select name="units" defaultValue={rate?.units ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime">
              <option value="">—</option>
              <option value="Hr">Hr</option>
              <option value="Each">Each</option>
              <option value="Sqft">Sqft</option>
              <option value="Feet">Feet</option>
            </select>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="active" defaultChecked={rate?.active !== false} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
              Active
            </label>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save</button>
          <Link href={`/dashboard/${orgSlug}/settings/machine-rates`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
        </div>
      </form>
    </div>
  )
}

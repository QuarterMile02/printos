import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import MaterialForm from '../material-form'
import { cloneMaterial, deleteMaterial } from '../actions-sr'

export const dynamic = 'force-dynamic'

export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string; id: string }>
  searchParams: Promise<{ edit?: string }>
}) {
  const { slug, id } = await params
  const sp = await searchParams
  const editing = sp.edit === '1'
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: matRow } = await supabase
    .from('materials')
    .select('id, name, external_name, cost, price, multiplier, buying_units, selling_units, formula, fixed_side, width, height, sheet_cost, wastage_markup, sell_buy_ratio, preferred_vendor, labor_charge, machine_charge, setup_charge, active, material_type_id, category_id')
    .eq('id', id)
    .eq('organization_id', org.id)
    .single()
  const m = matRow as {
    id: string; name: string; external_name: string | null
    cost: number | null; price: number | null; multiplier: number | null
    buying_units: string | null; selling_units: string | null
    formula: string | null; fixed_side: string | null
    width: number | null; height: number | null; sheet_cost: number | null
    wastage_markup: number | null; sell_buy_ratio: number | null
    preferred_vendor: string | null
    labor_charge: number | null; machine_charge: number | null; setup_charge: number | null
    active: boolean | null; material_type_id: string | null; category_id: string | null
  } | null
  if (!m) return <div className="p-8 text-red-600">Material not found</div>

  // Type name
  let typeName = '—'
  if (m.material_type_id) {
    const { data: t } = await supabase.from('material_types').select('name').eq('id', m.material_type_id).single()
    typeName = (t as { name: string } | null)?.name ?? '—'
  }

  // Used In products
  const { data: usedRows } = await supabase.from('product_default_items').select('product_id').eq('material_id', id)
  const usedProductIds = [...new Set(((usedRows ?? []) as { product_id: string }[]).map(u => u.product_id))]
  let usedInProducts: { id: string; name: string }[] = []
  if (usedProductIds.length > 0) {
    const { data: prods } = await supabase.from('products').select('id, name').in('id', usedProductIds)
    usedInProducts = (prods ?? []) as { id: string; name: string }[]
  }
  const canDelete = sp.edit === '1' && usedProductIds.length === 0

  const n = (v: number | null, d = 0) => Number(v ?? d)

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/settings/materials`} className="hover:text-gray-700">Materials</Link>
        <span>/</span>
        <span className="text-gray-700">{m.name}</span>
      </div>

      {editing ? (
        <>
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Material</h1>
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <MaterialForm material={m} orgId={org.id} orgSlug={slug} />
          </div>
        </>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900">{m.name}</h1>
              {m.external_name && <p className="text-sm text-gray-500">Display: {m.external_name}</p>}
              <p className="mt-1 text-sm text-gray-500">{typeName} &middot; {m.formula ?? 'Area'} &middot; {m.selling_units ?? 'Each'}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${m.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {m.active ? 'Active' : 'Inactive'}
              </span>
              <Link href={`/dashboard/${slug}/settings/materials/${id}?edit=1`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Edit
              </Link>
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Pricing</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">Cost</dt><dd className="font-medium tabular-nums">${n(m.cost).toFixed(4)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Price</dt><dd className="font-medium tabular-nums">${n(m.price).toFixed(4)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Multiplier</dt><dd className="font-medium tabular-nums">{n(m.multiplier, 2).toFixed(2)}x</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Sell/Buy Ratio</dt><dd className="font-medium tabular-nums">{n(m.sell_buy_ratio, 1).toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Sheet Cost</dt><dd className="font-medium tabular-nums">{m.sheet_cost != null ? `$${n(m.sheet_cost).toFixed(2)}` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Wastage Markup</dt><dd className="font-medium tabular-nums">{n(m.wastage_markup).toFixed(2)}%</dd></div>
              </dl>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Details</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">Formula</dt><dd className="font-medium">{m.formula ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Buying Units</dt><dd className="font-medium">{m.buying_units ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Selling Units</dt><dd className="font-medium">{m.selling_units ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Fixed Side</dt><dd className="font-medium">{m.fixed_side ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Width</dt><dd className="font-medium tabular-nums">{m.width != null ? `${n(m.width)}"` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Height</dt><dd className="font-medium tabular-nums">{m.height != null ? `${n(m.height)}"` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Preferred Vendor</dt><dd className="font-medium">{m.preferred_vendor ?? '—'}</dd></div>
              </dl>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:col-span-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Charges</h2>
              <dl className="grid grid-cols-3 gap-4 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">Labor</dt><dd className="font-medium tabular-nums">${n(m.labor_charge).toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Machine</dt><dd className="font-medium tabular-nums">${n(m.machine_charge).toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Setup</dt><dd className="font-medium tabular-nums">${n(m.setup_charge).toFixed(2)}</dd></div>
              </dl>
            </div>
          </div>

          {/* Used In + Actions */}
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">Used In ({usedProductIds.length} product{usedProductIds.length === 1 ? '' : 's'})</h2>
            {usedInProducts.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-4">
                {usedInProducts.map(p => (
                  <Link key={p.id} href={`/dashboard/${slug}/products/${p.id}`} className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200">{p.name}</Link>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400 mb-4">Not used in any products.</p>}

            <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
              <form action={cloneMaterial} className="inline">
                <input type="hidden" name="sourceId" value={id} />
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="orgSlug" value={slug} />
                <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">Clone Material</button>
              </form>
              {canDelete ? (
                <form action={deleteMaterial} className="inline">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="orgSlug" value={slug} />
                  <button type="submit" className="rounded-md border border-red-300 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50">Delete Material</button>
                </form>
              ) : usedProductIds.length > 0 ? (
                <span className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-400">Cannot delete — used in {usedProductIds.length} product{usedProductIds.length === 1 ? '' : 's'}</span>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

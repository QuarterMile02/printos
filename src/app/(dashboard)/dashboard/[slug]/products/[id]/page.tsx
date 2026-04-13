import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const supabase = await createClient()

  // Org
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .single()
  const org = orgRow as { id: string; name: string } | null

  // Product
  const { data: prodRow } = await supabase
    .from('products')
    .select('id, name, description, pricing_type, formula, cost, markup, price, status, active, taxable, units, workflow_template_id, category_id')
    .eq('id', id)
    .single()
  const p = prodRow as {
    id: string; name: string; description: string | null
    pricing_type: string | null; formula: string | null
    cost: number | null; markup: number | null; price: number | null
    status: string | null; active: boolean | null; taxable: boolean | null
    units: string | null; workflow_template_id: string | null; category_id: string | null
  } | null

  if (!p) {
    return (
      <div className="p-8">
        <p className="text-red-600 font-semibold">Product not found (id: {id})</p>
        <Link href={`/dashboard/${slug}/products`} className="text-sm text-qm-fuchsia hover:underline mt-2 inline-block">&larr; Back to Products</Link>
      </div>
    )
  }

  // Category name
  let categoryName: string | null = null
  if (p.category_id) {
    const { data: catRow } = await supabase.from('product_categories').select('name').eq('id', p.category_id).single()
    categoryName = (catRow as { name: string } | null)?.name ?? null
  }

  // Workflow name
  let workflowName: string | null = null
  if (p.workflow_template_id) {
    const { data: wfRow } = await supabase.from('workflow_templates').select('name').eq('id', p.workflow_template_id).single()
    workflowName = (wfRow as { name: string } | null)?.name ?? null
  }

  // Recipe items
  const { data: recipeRows } = await supabase
    .from('product_default_items')
    .select('id, item_type, material_id, labor_rate_id, machine_rate_id, custom_item_name, system_formula, multiplier, include_in_base_price, charge_per_li_unit')
    .eq('product_id', id)
    .order('sort_order')
  const recipeItems = (recipeRows ?? []) as {
    id: string; item_type: string
    material_id: string | null; labor_rate_id: string | null; machine_rate_id: string | null
    custom_item_name: string | null; system_formula: string | null
    multiplier: number | null; include_in_base_price: boolean | null; charge_per_li_unit: boolean | null
  }[]

  // Resolve recipe item names
  const matIds = recipeItems.filter(r => r.material_id).map(r => r.material_id!)
  const laborIds = recipeItems.filter(r => r.labor_rate_id).map(r => r.labor_rate_id!)
  const machineIds = recipeItems.filter(r => r.machine_rate_id).map(r => r.machine_rate_id!)

  const nameMap = new Map<string, string>()

  if (matIds.length > 0) {
    const { data } = await supabase.from('materials').select('id, name').in('id', matIds)
    for (const m of (data ?? []) as { id: string; name: string }[]) nameMap.set(m.id, m.name)
  }
  if (laborIds.length > 0) {
    const { data } = await supabase.from('labor_rates').select('id, name').in('id', laborIds)
    for (const l of (data ?? []) as { id: string; name: string }[]) nameMap.set(l.id, l.name)
  }
  if (machineIds.length > 0) {
    const { data } = await supabase.from('machine_rates').select('id, name').in('id', machineIds)
    for (const m of (data ?? []) as { id: string; name: string }[]) nameMap.set(m.id, m.name)
  }

  // Helpers
  const cost = Number(p.cost ?? 0)
  const price = Number(p.price ?? 0)
  const markup = Number(p.markup ?? 1)
  const margin = price > 0 ? ((price - cost) / price * 100).toFixed(1) : '—'

  const statusStyle = p.status === 'published'
    ? 'bg-green-50 text-green-700'
    : p.status === 'disabled'
      ? 'bg-red-50 text-red-700'
      : p.status === 'archived'
        ? 'bg-gray-100 text-gray-600'
        : 'bg-gray-100 text-gray-700'

  return (
    <div className="p-8 max-w-5xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org?.name ?? slug}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/products`} className="hover:text-gray-700">Products</Link>
        <span>/</span>
        <span className="text-gray-700">{p.name}</span>
      </div>

      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">{p.name}</h1>
            {p.description && <p className="mt-1 text-sm text-gray-600">{p.description}</p>}
            <div className="mt-2 flex items-center gap-3 text-sm text-gray-500">
              {categoryName && <span>{categoryName}</span>}
              {p.pricing_type && <span className="text-gray-300">|</span>}
              {p.pricing_type && <span>{p.pricing_type} pricing</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusStyle}`}>
              {p.status ?? 'draft'}
            </span>
            <Link
              href={`/dashboard/${slug}/products/${id}/edit`}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Edit
            </Link>
          </div>
        </div>
      </div>

      {/* Pricing + Details side by side */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pricing */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Pricing</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Formula</span>
              <span className="font-medium text-gray-900">{p.formula ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Cost</span>
              <span className="font-medium text-gray-900">${cost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Markup</span>
              <span className="font-medium text-gray-900">{markup.toFixed(2)}x</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-3">
              <span className="text-gray-500 font-semibold">Price</span>
              <span className="font-extrabold text-gray-900">${price.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Profit Margin</span>
              <span className={`font-semibold ${Number(margin) > 0 ? 'text-green-700' : 'text-gray-500'}`}>{margin}%</span>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Details</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Taxable</span>
              <span className="font-medium text-gray-900">{p.taxable ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Active</span>
              <span className="font-medium text-gray-900">{p.active ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Units</span>
              <span className="font-medium text-gray-900">{p.units ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Workflow</span>
              <span className="font-medium text-gray-900">{workflowName ?? '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recipe */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Product Recipe</h2>
          <Link
            href={`/dashboard/${slug}/products/${id}/edit`}
            className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            Edit Recipe
          </Link>
        </div>
        {recipeItems.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-400">No recipe items configured.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Formula</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Multiplier</th>
                <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">In Base</th>
                <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Per Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recipeItems.map((item) => {
                const refId = item.material_id ?? item.labor_rate_id ?? item.machine_rate_id
                const itemName = refId ? nameMap.get(refId) ?? '—' : item.custom_item_name ?? 'Custom'
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-sm text-gray-600">{item.item_type}</td>
                    <td className="px-6 py-3 text-sm font-medium text-gray-900">{itemName}</td>
                    <td className="px-6 py-3 text-sm text-gray-600">{item.system_formula ?? '—'}</td>
                    <td className="px-6 py-3 text-sm text-gray-900 text-right tabular-nums">{Number(item.multiplier ?? 1).toFixed(2)}</td>
                    <td className="px-6 py-3 text-center text-sm">{item.include_in_base_price ? '✓' : '—'}</td>
                    <td className="px-6 py-3 text-center text-sm">{item.charge_per_li_unit ? '✓' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

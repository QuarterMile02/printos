import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { addRecipeItem, deleteRecipeItem } from './add-recipe-action'

export const dynamic = 'force-dynamic'

const TYPE_STYLES: Record<string, string> = {
  Material: 'bg-amber-50 text-amber-700',
  LaborRate: 'bg-blue-50 text-blue-700',
  MachineRate: 'bg-purple-50 text-purple-700',
}
const TYPE_LABELS: Record<string, string> = {
  Material: 'Material',
  LaborRate: 'Labor Rate',
  MachineRate: 'Machine Rate',
}
const FORMULAS = ['Area', 'Perimeter', 'Width', 'Height', 'Unit', 'Fixed Qty']

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: prodRow } = await supabase.from('products').select('id, name').eq('id', id).single()
  const product = prodRow as { id: string; name: string } | null
  if (!product) return <div className="p-8 text-red-600">Product not found</div>

  // Load rate options
  const { data: matRows } = await supabase.from('materials').select('id, name').eq('organization_id', org.id).eq('active', true).order('name')
  const { data: laborRows } = await supabase.from('labor_rates').select('id, name').eq('organization_id', org.id).eq('active', true).order('name')
  const { data: machineRows } = await supabase.from('machine_rates').select('id, name').eq('organization_id', org.id).eq('active', true).order('name')
  const materials = (matRows ?? []) as { id: string; name: string }[]
  const laborRates = (laborRows ?? []) as { id: string; name: string }[]
  const machineRates = (machineRows ?? []) as { id: string; name: string }[]

  // Existing recipe items
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

  // Name lookup
  const nameMap = new Map<string, string>()
  for (const m of materials) nameMap.set(m.id, m.name)
  for (const l of laborRates) nameMap.set(l.id, l.name)
  for (const m of machineRates) nameMap.set(m.id, m.name)

  return (
    <div className="p-8 max-w-5xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/products`} className="hover:text-gray-700">Products</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/products/${id}`} className="hover:text-gray-700">{product.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Edit Recipe</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900">Recipe &mdash; {product.name}</h1>
        <Link href={`/dashboard/${slug}/products/${id}`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Done
        </Link>
      </div>

      {/* Existing items */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm mb-6">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Recipe Items ({recipeItems.length})</h2>
        </div>
        {recipeItems.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-400">No recipe items. Add items below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Formula</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Qty</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">&times; Qty</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">In Base</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recipeItems.map((item) => {
                  const refId = item.material_id ?? item.labor_rate_id ?? item.machine_rate_id
                  const itemName = refId ? nameMap.get(refId) ?? '—' : item.custom_item_name ?? 'Custom'
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_STYLES[item.item_type] ?? 'bg-gray-100 text-gray-600'}`}>
                          {TYPE_LABELS[item.item_type] ?? item.item_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{itemName}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{item.system_formula ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{Number(item.multiplier ?? 1).toFixed(2)}</td>
                      <td className="px-4 py-3 text-center text-sm">{item.charge_per_li_unit ? '✓' : '—'}</td>
                      <td className="px-4 py-3 text-center text-sm">{item.include_in_base_price ? '✓' : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <form action={deleteRecipeItem} className="inline">
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="productId" value={id} />
                          <input type="hidden" name="orgSlug" value={slug} />
                          <button type="submit" className="rounded p-1 text-gray-400 hover:text-red-500">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add new item form */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Add Recipe Item</h2>
        <form action={addRecipeItem}>
          <input type="hidden" name="productId" value={id} />
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="orgSlug" value={slug} />

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Type</label>
              <select name="itemType" required defaultValue="" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime">
                <option value="" disabled>&mdash; select &mdash;</option>
                <option value="Material">Material</option>
                <option value="LaborRate">Labor Rate</option>
                <option value="MachineRate">Machine Rate</option>
              </select>
            </div>

            <div className="col-span-2 sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Item</label>
              <select name="rateId" required defaultValue="" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime">
                <option value="" disabled>&mdash; select item &mdash;</option>
                <optgroup label="Materials">
                  {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </optgroup>
                <optgroup label="Labor Rates">
                  {laborRates.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </optgroup>
                <optgroup label="Machine Rates">
                  {machineRates.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </optgroup>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Formula</label>
              <select name="systemFormula" defaultValue="Area" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime">
                {FORMULAS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Qty / Multiplier</label>
              <input type="number" name="multiplier" defaultValue="1" step="0.01" min="0" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
            </div>

            <div className="flex items-end gap-4 pb-1">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" name="chargePerLiUnit" defaultChecked className="h-4 w-4 accent-qm-lime" />
                &times; Qty
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" name="includeInBasePrice" defaultChecked className="h-4 w-4 accent-qm-lime" />
                In Base
              </label>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Add to Recipe</button>
          </div>
        </form>
      </div>
    </div>
  )
}

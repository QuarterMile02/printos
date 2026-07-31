import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveMachineRate, cloneMachineRate } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'
import CostCalculator from './cost-calculator'
import MachineRatesListClient from './machine-rates-list-client'

export const dynamic = 'force-dynamic'

const FORMULAS = ['Area', 'Perimeter', 'Width', 'Height', 'Unit', 'Fixed Qty']
const UNITS = ['Hr', 'Each', 'Sqft', 'Feet', 'Inch', 'Yard', 'Roll', 'Sheet']
const CATEGORIES = [
  'Large Format Printing', 'Commercial Printing', 'Cutting', 'Routing',
  'Laminating', 'Finishing', 'Assembly', 'Fabrication', 'Installation',
  'Design', 'Vehicle Wrap', 'Channel Letters', 'Electrical', 'Other',
]
const PRODUCTION_RATE_UNITS = ['Sq Ft/Hr', 'Linear Ft/Hr', 'Units/Hr', 'Minutes/Unit', 'Hours/Unit', 'Sq Ft/Min']
const DIFFICULTIES = ['Simple', 'Moderate', 'Complex']

type Rate = {
  id: string
  name: string
  external_name: string | null
  cost: number | null
  price: number | null
  markup: number | null
  formula: string | null
  units: string | null
  production_rate: number | null
  production_rate_units: string | null
  setup_charge: number | null
  labor_charge: number | null
  other_charge: number | null
  include_in_base_price: boolean | null
  description: string | null
  show_internal: boolean | null
  display_name_in_line_item: boolean | null
  active: boolean | null
  // Migration 046 fields
  category: string | null
  subcategory: string | null
  material_category_ids: string[] | null
  linked_labor_rate_id: string | null
  margin_width: number | null
  margin_height: number | null
  difficulty: string | null
  per_li_unit: boolean | null
  cog_account: string | null
  volume_discount_id: string | null
  department_id: string | null
  calc_equipment_cost: number | null
  calc_life_expectancy_years: number | null
  calc_days_per_year: number | null
  calc_hours_per_day: number | null
  calc_productivity_percent: number | null
}

type MaterialCategory = { id: string; name: string }
type LaborRateOption = { id: string; name: string }
type DiscountOption = { id: string; name: string }
type DepartmentOption = { id: string; name: string }

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[machine-rates] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (machine-rates)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && (
          <>
            <div style={{ marginTop: '1rem' }}><strong>Stack:</strong></div>
            <pre style={{ fontSize: '0.75rem', overflowX: 'auto' }}>{stack}</pre>
          </>
        )}
      </div>
    )
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  // Permission gate — owner + accounting only. Run alongside the auth/member
  // lookups (independent of each other and of the permission result) rather
  // than sequentially — checkPermission() already does its own internal
  // auth.getUser() + profile round trip, so chaining more awaits after it
  // just stacks additional serial round trips before anything can render.
  type MemberRow = { user_id: string; role: string }
  const [permResult, userResult, memberRes] = await Promise.all([
    checkPermission(org.id, 'settings.machine_rates'),
    supabase.auth.getUser(),
    supabase.from('organization_members').select('user_id, role').eq('organization_id', org.id),
  ])

  if (!permResult.allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-extrabold text-qm-black">Machine Rates</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to view machine rates. Contact your organization owner to request access.
        </div>
      </div>
    )
  }

  const userId = userResult.data.user?.id ?? ''
  const memberRows = (memberRes.data ?? []) as MemberRow[]
  const userRole = memberRows.find((m) => m.user_id === userId)?.role ?? 'member'

  const [ratesRes, countRes] = await Promise.all([
    supabase
      .from('machine_rates')
      .select('id, name, external_name, cost, price, markup, formula, units, production_rate, production_rate_units, setup_charge, labor_charge, other_charge, include_in_base_price, description, show_internal, display_name_in_line_item, active, category, subcategory, material_category_ids, linked_labor_rate_id, margin_width, margin_height, difficulty, per_li_unit, cog_account, volume_discount_id, department_id, calc_equipment_cost, calc_life_expectancy_years, calc_days_per_year, calc_hours_per_day, calc_productivity_percent')
      .eq('organization_id', org.id)
      .order('name', { ascending: true })
      .limit(1000),
    supabase
      .from('machine_rates')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id),
  ])
  if (ratesRes.error) {
    console.error('[machine-rates] machine_rates SELECT failed:', ratesRes.error)
    throw new Error(`machine_rates SELECT failed: ${ratesRes.error.message ?? JSON.stringify(ratesRes.error)}`)
  }
  const totalCount = countRes.count ?? 0
  const rates = (ratesRes.data ?? []) as Rate[]

  const editId = sp.edit
  const showAdd = sp.add === '1'
  const editRate = editId ? rates.find(r => r.id === editId) ?? null : null
  const isPanelOpen = Boolean(editRate || showAdd)

  // Departments — always fetched (needed for both list and panel form)
  let departments: DepartmentOption[] = []
  try {
    const { data: deptData } = await supabase
      .from('departments')
      .select('id, name')
      .eq('organization_id', org.id)
      .order('sort_order', { ascending: true }) as { data: DepartmentOption[] | null; error: unknown }
    departments = deptData ?? []
  } catch { /* departments table may not exist */ }
  const deptMap = new Map(departments.map(d => [d.id, d.name]))

  // Junction table: rate → assigned dept IDs
  const rateDeptMap = new Map<string, string[]>()
  if (rates.length > 0) {
    try {
      const { data: mrdData } = await supabase
        .from('machine_rate_departments')
        .select('machine_rate_id, department_id')
        .in('machine_rate_id', rates.map(r => r.id))
      for (const row of (mrdData ?? []) as { machine_rate_id: string; department_id: string }[]) {
        const arr = rateDeptMap.get(row.machine_rate_id) ?? []
        arr.push(row.department_id)
        rateDeptMap.set(row.machine_rate_id, arr)
      }
    } catch { /* table may not exist yet */ }
  }
  const selectedDeptIds = new Set(editRate ? (rateDeptMap.get(editRate.id) ?? []) : [])
  const deptMapObj: Record<string, string> = Object.fromEntries(deptMap)
  const rateDeptMapObj: Record<string, string[]> = Object.fromEntries(rateDeptMap)

  // Lookups for dropdowns (only fetched when panel is open)
  let materialCategories: MaterialCategory[] = []
  let laborRates: LaborRateOption[] = []
  let discounts: DiscountOption[] = []
  if (isPanelOpen) {
    const [mcRes, lrRes, dRes] = await Promise.all([
      supabase.from('material_categories').select('id, name').eq('organization_id', org.id).order('name'),
      supabase.from('labor_rates').select('id, name').eq('organization_id', org.id).order('name'),
      supabase.from('discounts').select('id, name').eq('organization_id', org.id).order('name'),
    ])
    if (mcRes.error) console.error('[machine-rates] material_categories SELECT:', mcRes.error)
    if (lrRes.error) console.error('[machine-rates] labor_rates SELECT:', lrRes.error)
    if (dRes.error) console.error('[machine-rates] discounts SELECT:', dRes.error)
    materialCategories = (mcRes.data ?? []) as MaterialCategory[]
    laborRates = (lrRes.data ?? []) as LaborRateOption[]
    discounts = (dRes.data ?? []) as DiscountOption[]
  }

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
  const selectedMaterialIds = new Set(editRate?.material_category_ids ?? [])
  const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const numInputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const labelCls = 'block text-xs font-medium text-gray-500'
  const sectionCls = 'space-y-3'
  const sectionTitleCls = 'text-xs font-bold uppercase tracking-wider text-gray-500 border-b border-gray-200 pb-1'

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Machine Rates</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-extrabold text-qm-black">Machine Rates <span className="text-sm font-normal text-gray-400">({totalCount})</span></h1>
        <div className="flex gap-2">
          <a href={`/api/export/machine-rates?orgId=${org.id}`} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Export CSV</a>
          <Link href={`/dashboard/${slug}/settings/machine-rates/import`} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Import CSV</Link>
          <Link href={`/dashboard/${slug}/settings/machine-rates?add=1`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">+ New Rate</Link>
        </div>
      </div>

      {isPanelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
            </div>
          )}
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">{editRate ? 'Edit Rate' : 'New Machine Rate'}</h2>
          <form action={saveMachineRate} className="space-y-6">
            {editRate && <input type="hidden" name="id" value={editRate.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />

            {/* General */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>General</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Name *</label>
                  <input type="text" name="name" required defaultValue={editRate?.name ?? ''} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>External Name</label>
                  <input type="text" name="external_name" defaultValue={editRate?.external_name ?? ''} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Departments</label>
                {departments.length === 0 ? (
                  <p className="mt-1 text-xs text-gray-400 italic">No departments defined.</p>
                ) : (
                  <details className="mt-1 rounded-md border border-gray-300 bg-white">
                    <summary className="cursor-pointer px-3 py-2 text-sm text-gray-700 select-none">
                      {selectedDeptIds.size === 0 ? 'Select departments…' : `${selectedDeptIds.size} selected`}
                    </summary>
                    <div className="border-t border-gray-200 px-3 py-2 max-h-48 overflow-y-auto space-y-1">
                      {departments.map(d => (
                        <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                          <input type="checkbox" name="department_ids" value={d.id} defaultChecked={selectedDeptIds.has(d.id)} className="h-4 w-4 accent-qm-lime" />
                          <span>{d.name}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>

            {/* Category */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Category</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Category</label>
                  <select name="category" defaultValue={editRate?.category ?? ''} className={inputCls}>
                    <option value="">—</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Subcategory</label>
                  <input type="text" name="subcategory" defaultValue={editRate?.subcategory ?? ''} className={inputCls} />
                </div>
              </div>
            </div>

            {/* Material Categories */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Material Categories</h3>
              <p className="text-xs text-gray-500">Links this machine to compatible materials for auto-pairing on jobs</p>
              {materialCategories.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No material categories defined. Create some under Settings → Material Categories.</p>
              ) : (
                <details className="rounded-md border border-gray-300 bg-white">
                  <summary className="cursor-pointer px-3 py-2 text-sm text-gray-700 select-none">
                    {selectedMaterialIds.size === 0
                      ? 'Select material categories…'
                      : `${selectedMaterialIds.size} selected`}
                  </summary>
                  <div className="border-t border-gray-200 px-3 py-2 max-h-48 overflow-y-auto space-y-1">
                    {materialCategories.map(cat => (
                      <label key={cat.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                        <input
                          type="checkbox"
                          name="material_category_ids"
                          value={cat.id}
                          defaultChecked={selectedMaterialIds.has(cat.id)}
                          className="h-4 w-4 accent-qm-lime"
                        />
                        <span>{cat.name}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </div>

            {/* Linked Labor Rate */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Linked Labor Rate</h3>
              <p className="text-xs text-gray-500">Auto-adds this labor rate when machine is selected in a product recipe</p>
              <select name="linked_labor_rate_id" defaultValue={editRate?.linked_labor_rate_id ?? ''} className={inputCls}>
                <option value="">— None —</option>
                {laborRates.map(lr => <option key={lr.id} value={lr.id}>{lr.name}</option>)}
              </select>
            </div>

            {/* Cost / Price */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Cost &amp; Price</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Cost ($)</label>
                  <input type="number" name="cost" step="0.01" defaultValue={n(editRate?.cost).toFixed(2)} className={numInputCls} />
                </div>
                <div>
                  <label className={labelCls}>Price ($)</label>
                  <input type="number" name="price" step="0.01" defaultValue={n(editRate?.price).toFixed(2)} className={numInputCls} />
                </div>
              </div>
            </div>

            {/* Cost Calculator (collapsible) */}
            <CostCalculator
              initial={{
                calc_equipment_cost: editRate?.calc_equipment_cost ?? null,
                calc_life_expectancy_years: editRate?.calc_life_expectancy_years ?? null,
                calc_days_per_year: editRate?.calc_days_per_year ?? null,
                calc_hours_per_day: editRate?.calc_hours_per_day ?? null,
                calc_productivity_percent: editRate?.calc_productivity_percent ?? null,
              }}
            />

            {/* Formula & Units */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Formula &amp; Units</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Formula</label>
                  <select name="formula" defaultValue={editRate?.formula ?? 'Area'} className={inputCls}>
                    {FORMULAS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Units</label>
                  <select name="units" defaultValue={editRate?.units ?? 'Sqft'} className={inputCls}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Charges */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Charges</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Setup Charge</label>
                  <input type="number" name="setup_charge" step="0.01" defaultValue={n(editRate?.setup_charge).toFixed(2)} className={numInputCls} />
                </div>
                <div>
                  <label className={labelCls}>Labor Charge</label>
                  <input type="number" name="labor_charge" step="0.01" defaultValue={n(editRate?.labor_charge).toFixed(2)} className={numInputCls} />
                </div>
                <div>
                  <label className={labelCls}>Other Charge</label>
                  <input type="number" name="other_charge" step="0.01" defaultValue={n(editRate?.other_charge).toFixed(2)} className={numInputCls} />
                </div>
              </div>
            </div>

            {/* Production Rate */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Production Rate</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Production Rate</label>
                  <input type="number" name="production_rate" step="0.01" defaultValue={editRate?.production_rate ?? ''} className={numInputCls} />
                </div>
                <div>
                  <label className={labelCls}>Prod. Rate Units</label>
                  <select name="production_rate_units" defaultValue={editRate?.production_rate_units ?? ''} className={inputCls}>
                    <option value="">—</option>
                    {PRODUCTION_RATE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Margins & Difficulty */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Margins &amp; Difficulty</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Margin Width</label>
                  <input type="number" name="margin_width" step="0.01" defaultValue={editRate?.margin_width ?? ''} className={numInputCls} />
                </div>
                <div>
                  <label className={labelCls}>Margin Height</label>
                  <input type="number" name="margin_height" step="0.01" defaultValue={editRate?.margin_height ?? ''} className={numInputCls} />
                </div>
                <div>
                  <label className={labelCls}>Difficulty</label>
                  <select name="difficulty" defaultValue={editRate?.difficulty ?? ''} className={inputCls}>
                    <option value="">—</option>
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Accounting */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Accounting</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>COG Account</label>
                  <input type="text" name="cog_account" defaultValue={editRate?.cog_account ?? ''} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Volume Discount</label>
                  <select name="volume_discount_id" defaultValue={editRate?.volume_discount_id ?? ''} className={inputCls}>
                    <option value="">— None —</option>
                    {discounts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Flags */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Flags</h3>
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" name="include_in_base_price" defaultChecked={editRate?.include_in_base_price === true} className="h-4 w-4 accent-qm-lime" />
                  In Base
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" name="per_li_unit" defaultChecked={editRate?.per_li_unit === true} className="h-4 w-4 accent-qm-lime" />
                  Per LI Unit
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" name="show_internal" defaultChecked={editRate?.show_internal !== false} className="h-4 w-4 accent-qm-lime" />
                  Internal
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" name="active" defaultChecked={editRate?.active !== false} className="h-4 w-4 accent-qm-lime" />
                  Active
                </label>
              </div>
            </div>

            {/* Notes */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Notes</h3>
              <textarea name="description" rows={2} defaultValue={editRate?.description ?? ''} className={inputCls} />
            </div>

            {/* Buttons */}
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save</button>
              <Link href={`/dashboard/${slug}/settings/machine-rates`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
            </div>
          </form>

          {editRate && (
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={cloneMachineRate} className="inline">
                <input type="hidden" name="sourceId" value={editRate.id} />
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="orgSlug" value={slug} />
                <input type="hidden" name="targetTable" value="machine_rates" />
                <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">Clone as Machine</button>
              </form>
              <form action={cloneMachineRate} className="inline">
                <input type="hidden" name="sourceId" value={editRate.id} />
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="orgSlug" value={slug} />
                <input type="hidden" name="targetTable" value="labor_rates" />
                <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">Clone as Labor</button>
              </form>
            </div>
          )}

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

      {!isPanelOpen && totalCount > 1000 && (
        <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Showing 1000 of {totalCount} — use search to filter
        </p>
      )}

      {!isPanelOpen && (
        <MachineRatesListClient
          rates={rates.map((r) => ({
            id: r.id,
            name: r.name,
            external_name: r.external_name,
            cost: r.cost,
            price: r.price,
            markup: r.markup,
            formula: r.formula,
            units: r.units,
            production_rate: r.production_rate,
            active: r.active,
            department_id: r.department_id,
          }))}
          rateDeptMap={rateDeptMapObj}
          deptMap={deptMapObj}
          orgSlug={slug}
          orgId={org.id}
          userId={userId}
          userRole={userRole}
        />
      )}
    </div>
  )
}

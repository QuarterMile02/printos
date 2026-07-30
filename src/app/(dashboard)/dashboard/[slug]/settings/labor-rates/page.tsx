import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveLaborRate, cloneLaborRate } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'

export const dynamic = 'force-dynamic'

const FORMULAS = ['Area', 'Perimeter', 'Width', 'Height', 'Unit', 'Fixed Qty']
const UNITS = ['Hr', 'Each', 'Sqft', 'Feet', 'Inch', 'Yard', 'Roll', 'Sheet']
const CATEGORIES = [
  'Large Format Printing', 'Commercial Printing', 'Cutting', 'Routing',
  'Laminating', 'Finishing', 'Assembly', 'Fabrication', 'Installation',
  'Design', 'Vehicle Wrap', 'Channel Letters', 'Electrical', 'Other',
]
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
  machine_charge: number | null
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
  linked_machine_rate_id: string | null
  operator_attendance_percent: number | null
  production_factor: number | null
  production_rate_prompt: string | null
  production_rate_prompt_detail: string | null
  margin_width: number | null
  margin_height: number | null
  difficulty: string | null
  per_li_unit: boolean | null
  cog_account: string | null
  volume_discount_id: string | null
  department_id: string | null
}

type MaterialCategory = { id: string; name: string }
type MachineRateOption = { id: string; name: string }
type DiscountOption = { id: string; name: string }
type DepartmentOption = { id: string; name: string }

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ search?: string; formula?: string; status?: string; edit?: string; add?: string; saved?: string; sort?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[labor-rates] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (labor-rates)</h1>
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
  const sortDesc = sp.sort === 'desc'
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  // Permission gate — owner + accounting only
  const { allowed } = await checkPermission(org.id, 'settings.labor_rates')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-extrabold text-qm-black">Labor Rates</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to view labor rates. Contact your organization owner to request access.
        </div>
      </div>
    )
  }

  const [ratesRes, countRes] = await Promise.all([
    supabase
      .from('labor_rates')
      .select('id, name, external_name, cost, price, markup, formula, units, production_rate, production_rate_units, setup_charge, machine_charge, other_charge, include_in_base_price, description, show_internal, display_name_in_line_item, active, category, subcategory, material_category_ids, linked_machine_rate_id, operator_attendance_percent, production_factor, production_rate_prompt, production_rate_prompt_detail, margin_width, margin_height, difficulty, per_li_unit, cog_account, volume_discount_id, department_id')
      .eq('organization_id', org.id)
      .order('name', { ascending: !sortDesc })
      .limit(1000),
    supabase
      .from('labor_rates')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id),
  ])
  if (ratesRes.error) {
    console.error('[labor-rates] labor_rates SELECT failed:', ratesRes.error)
    throw new Error(`labor_rates SELECT failed: ${ratesRes.error.message ?? JSON.stringify(ratesRes.error)}`)
  }
  const totalCount = countRes.count ?? 0
  let rates = (ratesRes.data ?? []) as Rate[]

  const search = sp.search?.trim().toLowerCase() ?? ''
  if (search) rates = rates.filter(r => r.name.toLowerCase().includes(search))
  if (sp.formula) rates = rates.filter(r => r.formula === sp.formula)
  if (sp.status === 'active') rates = rates.filter(r => r.active !== false)
  if (sp.status === 'inactive') rates = rates.filter(r => r.active === false)

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
      const { data: lrdData } = await supabase
        .from('labor_rate_departments')
        .select('labor_rate_id, department_id')
        .in('labor_rate_id', rates.map(r => r.id))
      for (const row of (lrdData ?? []) as { labor_rate_id: string; department_id: string }[]) {
        const arr = rateDeptMap.get(row.labor_rate_id) ?? []
        arr.push(row.department_id)
        rateDeptMap.set(row.labor_rate_id, arr)
      }
    } catch { /* table may not exist yet */ }
  }
  const selectedDeptIds = new Set(editRate ? (rateDeptMap.get(editRate.id) ?? []) : [])

  // Lookups for dropdowns (only when panel is open)
  let materialCategories: MaterialCategory[] = []
  let machineRates: MachineRateOption[] = []
  let discounts: DiscountOption[] = []
  if (isPanelOpen) {
    const [mcRes, mrRes, dRes] = await Promise.all([
      supabase.from('material_categories').select('id, name').eq('organization_id', org.id).order('name'),
      supabase.from('machine_rates').select('id, name').eq('organization_id', org.id).order('name'),
      supabase.from('discounts').select('id, name').eq('organization_id', org.id).order('name'),
    ])
    if (mcRes.error) console.error('[labor-rates] material_categories SELECT:', mcRes.error)
    if (mrRes.error) console.error('[labor-rates] machine_rates SELECT:', mrRes.error)
    if (dRes.error) console.error('[labor-rates] discounts SELECT:', dRes.error)
    materialCategories = (mcRes.data ?? []) as MaterialCategory[]
    machineRates = (mrRes.data ?? []) as MachineRateOption[]
    discounts = (dRes.data ?? []) as DiscountOption[]
  }

  // Used-in count for editing rate
  let usedInCount = 0
  let usedInProducts: { id: string; name: string }[] = []
  if (editRate) {
    const { data: used } = await supabase.from('product_default_items').select('product_id').eq('labor_rate_id', editRate.id)
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
        <span className="text-gray-700">Labor Rates</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-extrabold text-qm-black">Labor Rates <span className="text-sm font-normal text-gray-400">({totalCount})</span></h1>
        <div className="flex gap-2">
          {(() => {
            const p = new URLSearchParams()
            if (sp.search) p.set('search', sp.search)
            if (sp.formula) p.set('formula', sp.formula)
            if (sp.status) p.set('status', sp.status)
            if (!sortDesc) p.set('sort', 'desc')
            return (
              <Link
                href={`/dashboard/${slug}/settings/labor-rates?${p}`}
                className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${!sortDesc ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
              >
                {sortDesc ? 'Z-A ↓' : 'A-Z ↑'}
              </Link>
            )
          })()}
          <a href={`/api/export/labor-rates?orgId=${org.id}`} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Export CSV</a>
          <Link href={`/dashboard/${slug}/settings/labor-rates/import`} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Import CSV</Link>
          <Link href={`/dashboard/${slug}/settings/labor-rates?add=1`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">+ New Rate</Link>
        </div>
      </div>

      <form className="mb-4 flex flex-wrap gap-3">
        {sortDesc && <input type="hidden" name="sort" value="desc" />}
        <input type="text" name="search" defaultValue={search} placeholder="Search by name..." className="rounded-md border border-gray-300 px-3 py-2 text-sm w-64 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
        <select name="formula" defaultValue={sp.formula ?? ''} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none">
          <option value="">All Formulas</option>
          {FORMULAS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Filter</button>
      </form>

      {isPanelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
            </div>
          )}
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">{editRate ? 'Edit Rate' : 'New Labor Rate'}</h2>
          <form action={saveLaborRate} className="space-y-6">
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
              <p className="text-xs text-gray-500">Links this labor rate to compatible materials for auto-pairing on jobs</p>
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

            {/* Linked Machine Rate */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Linked Machine Rate</h3>
              <p className="text-xs text-gray-500">Auto-adds this machine rate when labor is selected in a product recipe</p>
              <select name="linked_machine_rate_id" defaultValue={editRate?.linked_machine_rate_id ?? ''} className={inputCls}>
                <option value="">— None —</option>
                {machineRates.map(mr => <option key={mr.id} value={mr.id}>{mr.name}</option>)}
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

            {/* Formula & Units */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Formula &amp; Units</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Formula</label>
                  <select name="formula" defaultValue={editRate?.formula ?? 'Unit'} className={inputCls}>
                    {FORMULAS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Units</label>
                  <select name="units" defaultValue={editRate?.units ?? 'Hr'} className={inputCls}>
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
                  <label className={labelCls}>Machine Charge</label>
                  <input type="number" name="machine_charge" step="0.01" defaultValue={n(editRate?.machine_charge).toFixed(2)} className={numInputCls} />
                </div>
                <div>
                  <label className={labelCls}>Other Charge</label>
                  <input type="number" name="other_charge" step="0.01" defaultValue={n(editRate?.other_charge).toFixed(2)} className={numInputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Operator Attendance %</label>
                <input
                  type="number" name="operator_attendance_percent" step="0.01" min="0" max="100"
                  defaultValue={editRate?.operator_attendance_percent ?? 100}
                  className={numInputCls}
                />
                <p className="mt-1 text-xs text-gray-500">% of machine run time the operator is required (e.g. 25% = operator needed only 25% of run time)</p>
              </div>
            </div>

            {/* Production Rate */}
            <div className={sectionCls}>
              <h3 className={sectionTitleCls}>Production Rate</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Production Rate</label>
                  <input type="number" name="production_rate" step="0.01" defaultValue={editRate?.production_rate ?? ''} className={numInputCls} />
                </div>
                <div>
                  <label className={labelCls}>Prod. Rate Units</label>
                  <input type="text" name="production_rate_units" defaultValue={editRate?.production_rate_units ?? ''} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Production Factor</label>
                  <input type="number" name="production_factor" step="0.0001" defaultValue={editRate?.production_factor ?? ''} className={numInputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Production Rate Prompt</label>
                <textarea
                  name="production_rate_prompt" rows={3}
                  defaultValue={editRate?.production_rate_prompt ?? ''}
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-500">Shown on quote builder so sales rep knows what to enter</p>
              </div>
              <div>
                <label className={labelCls}>Production Rate Prompt Detail</label>
                <textarea
                  name="production_rate_prompt_detail" rows={3}
                  defaultValue={editRate?.production_rate_prompt_detail ?? ''}
                  className={inputCls}
                />
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
                  <input type="checkbox" name="display_name_in_line_item" defaultChecked={editRate?.display_name_in_line_item === true} className="h-4 w-4 accent-qm-lime" />
                  Show Name
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
              <Link href={`/dashboard/${slug}/settings/labor-rates`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
            </div>
          </form>

          {editRate && (
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={cloneLaborRate} className="inline">
                <input type="hidden" name="sourceId" value={editRate.id} />
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="orgSlug" value={slug} />
                <input type="hidden" name="targetTable" value="labor_rates" />
                <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">Clone as Labor</button>
              </form>
              <form action={cloneLaborRate} className="inline">
                <input type="hidden" name="sourceId" value={editRate.id} />
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="orgSlug" value={slug} />
                <input type="hidden" name="targetTable" value="machine_rates" />
                <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">Clone as Machine</button>
              </form>
            </div>
          )}

          {editRate && (
            <div className="mt-6 border-t border-gray-200 pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Used In ({usedInCount} product{usedInCount === 1 ? '' : 's'})</h3>
              {usedInProducts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {usedInProducts.map(p => (
                    <Link key={p.id} href={`/dashboard/${slug}/products/${p.id}`} className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200">{p.name}</Link>
                  ))}
                </div>
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
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Ext. Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Department</th>
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
                <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400">No labor rates{search ? ` matching "${search}"` : ''}.</td></tr>
              ) : rates.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><Link href={`/dashboard/${slug}/settings/labor-rates?edit=${r.id}`} className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia">{r.name}</Link></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{r.external_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {(() => {
                      const dIds = rateDeptMap.get(r.id) ?? []
                      if (dIds.length > 0) return dIds.map(id => deptMap.get(id)).filter(Boolean).join(', ') || '—'
                      return r.department_id ? (deptMap.get(r.department_id) ?? '—') : '—'
                    })()}
                  </td>
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
      )}
    </div>
  )
}

'use client'

import { useState, useMemo, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Material, MaterialType, MaterialCategory, MaterialVendor, Discount } from '@/types/product-builder'
import {
  createMaterial,
  updateMaterial,
  toggleMaterialActive,
  type MaterialFormData,
  type VendorRowInput,
} from './actions'

type DiscountOption = Pick<Discount, 'id' | 'name' | 'discount_type' | 'applies_to' | 'discount_by' | 'active'>

type Props = {
  orgId: string
  orgSlug: string
  initialMaterials: Material[]
  materialTypes: MaterialType[]
  materialCategories: MaterialCategory[]
  discounts: DiscountOption[]
  vendorsByMaterial: Record<string, MaterialVendor[]>
}

type TabKey = 'details' | 'pricing' | 'package' | 'wastage' | 'inventory' | 'accounting' | 'vendors' | 'remnants'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'package', label: 'Package' },
  { key: 'wastage', label: 'Wastage' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'vendors', label: 'Vendor Pricing' },
  { key: 'remnants', label: 'Remnants' },
]

const UNIT_OPTIONS = ['Sqft', 'Unit', 'Inch', 'Feet', 'Roll', 'Sheet', 'Yard', 'Each', 'Piece']
const FORMULA_OPTIONS = ['None', 'Area', 'Unit', 'Width', 'Height', 'Volume', 'Perimeter']
const QB_ITEM_TYPES = ['Inventory', 'Non-Inventory', 'Service']
const WEIGHT_UOMS = ['lbs', 'kg', 'oz']

function formatMoney(v: number | null | undefined): string {
  if (v == null) return '—'
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function emptyForm(): MaterialFormData {
  return {
    name: '', external_name: null, material_type_id: null, category_id: null,
    description: null, po_description: null, info_url: null, image_url: null,
    show_internal: false, show_external: false, print_image_on_pdf: false,
    cost: 0, price: 0, multiplier: 1,
    selling_units: null, buying_units: null, sell_buy_ratio: null, conversion_factor: null,
    per_li_unit: null,
    setup_charge: null, labor_charge: null, machine_charge: null, other_charge: null,
    formula: null, include_in_base_price: false, percentage_of_base: null, discount_id: null,
    width: null, height: null, fixed_side: null, fixed_quantity: null, sheet_cost: null,
    weight: null, weight_uom: null,
    calculate_wastage: false, wastage_markup: null, allow_variants: false,
    track_inventory: false, in_use: true,
    cog_account_name: null, cog_account_number: null, qb_item_type: null,
    remnant_width: null, remnant_length: null, remnant_location: null, remnant_usable: false,
    active: true,
  }
}

function toFormData(m: Material): MaterialFormData {
  return {
    name: m.name,
    external_name: m.external_name,
    material_type_id: m.material_type_id,
    category_id: m.category_id,
    description: m.description,
    po_description: m.po_description,
    info_url: m.info_url,
    image_url: m.image_url,
    show_internal: m.show_internal ?? false,
    show_external: m.show_external ?? false,
    print_image_on_pdf: m.print_image_on_pdf ?? false,
    cost: Number(m.cost),
    price: Number(m.price),
    multiplier: Number(m.multiplier ?? 1),
    selling_units: m.selling_units,
    buying_units: m.buying_units,
    sell_buy_ratio: m.sell_buy_ratio,
    conversion_factor: m.conversion_factor,
    per_li_unit: m.per_li_unit,
    setup_charge: m.setup_charge,
    labor_charge: m.labor_charge,
    machine_charge: m.machine_charge,
    other_charge: m.other_charge,
    formula: m.formula,
    include_in_base_price: m.include_in_base_price ?? false,
    percentage_of_base: m.percentage_of_base,
    discount_id: m.discount_id,
    width: m.width,
    height: m.height,
    fixed_side: m.fixed_side,
    fixed_quantity: m.fixed_quantity,
    sheet_cost: m.sheet_cost,
    weight: m.weight,
    weight_uom: m.weight_uom,
    calculate_wastage: m.calculate_wastage ?? false,
    wastage_markup: m.wastage_markup,
    allow_variants: m.allow_variants ?? false,
    track_inventory: m.track_inventory ?? false,
    in_use: m.in_use ?? true,
    cog_account_name: m.cog_account_name,
    cog_account_number: m.cog_account_number,
    qb_item_type: m.qb_item_type,
    remnant_width: m.remnant_width,
    remnant_length: m.remnant_length,
    remnant_location: m.remnant_location,
    remnant_usable: m.remnant_usable ?? false,
    active: m.active ?? true,
  }
}

function emptyVendor(): VendorRowInput {
  return {
    vendor_name: '', vendor_price: 0, rank: 0,
    buying_units: null, length_per_unit: null,
    part_name: null, part_number: null, delivery_fee: null,
    min_stock_level: null, max_stock_level: null, min_order_value: null,
    active: true,
  }
}

function vendorToInput(v: MaterialVendor): VendorRowInput {
  return {
    vendor_name: v.vendor_name,
    vendor_price: Number(v.vendor_price),
    rank: v.rank ?? 0,
    buying_units: v.buying_units,
    length_per_unit: v.length_per_unit,
    part_name: v.part_name,
    part_number: v.part_number,
    delivery_fee: v.delivery_fee,
    min_stock_level: v.min_stock_level,
    max_stock_level: v.max_stock_level,
    min_order_value: v.min_order_value,
    active: v.active ?? true,
  }
}

export default function MaterialsClient({
  orgId, orgSlug, initialMaterials, materialTypes, materialCategories, discounts, vendorsByMaterial,
}: Props) {
  const router = useRouter()
  const [materials] = useState<Material[]>(initialMaterials)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<MaterialFormData>(emptyForm())
  const [vendors, setVendors] = useState<VendorRowInput[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>('details')
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  function openEdit(m: Material) {
    setForm(toFormData(m))
    setVendors((vendorsByMaterial[m.id] ?? []).map(vendorToInput))
    setEditingId(m.id)
    setIsNew(false)
    setActiveTab('details')
    setFormError(null)
  }
  function openNew() {
    setForm(emptyForm())
    setVendors([])
    setEditingId(null)
    setIsNew(true)
    setActiveTab('details')
    setFormError(null)
  }
  function closeForm() {
    setEditingId(null)
    setIsNew(false)
    setFormError(null)
  }
  const isFormOpen = isNew || editingId !== null

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  // Cost/Price/Multiplier triangle (multiplier = markup)
  function setCost(cost: number) {
    setForm((f) => ({ ...f, cost, price: Number((cost * f.multiplier).toFixed(2)) }))
  }
  function setPrice(price: number) {
    setForm((f) => ({ ...f, price, multiplier: f.cost > 0 ? Number((price / f.cost).toFixed(4)) : f.multiplier }))
  }
  function setMultiplier(multiplier: number) {
    setForm((f) => ({ ...f, multiplier, price: Number((f.cost * multiplier).toFixed(2)) }))
  }

  const profitMargin = useMemo(() => {
    if (form.price <= 0) return null
    return ((form.price - form.cost) / form.price * 100).toFixed(2)
  }, [form.cost, form.price])

  // Filter categories by selected type (in form AND in list filter)
  const filteredCategoriesForForm = useMemo(() => {
    if (!form.material_type_id) return materialCategories
    return materialCategories.filter((c) => c.material_type_id === form.material_type_id)
  }, [form.material_type_id, materialCategories])

  const filteredCategoriesForListFilter = useMemo(() => {
    if (typeFilter === 'all') return materialCategories
    return materialCategories.filter((c) => c.material_type_id === typeFilter)
  }, [typeFilter, materialCategories])

  // List filter — partial match (ilike equivalent)
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return materials.filter((m) => {
      if (activeFilter === 'active' && !m.active) return false
      if (activeFilter === 'inactive' && m.active) return false
      if (typeFilter !== 'all' && m.material_type_id !== typeFilter) return false
      if (categoryFilter !== 'all' && m.category_id !== categoryFilter) return false
      if (term) {
        const hay = `${m.name} ${m.external_name ?? ''} ${m.part_number ?? ''} ${m.sku ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [materials, search, activeFilter, typeFilter, categoryFilter])

  // Pagination — 100 rows per page over the filtered list. When filters
  // change the total can shrink, so reset to page 1 whenever they do.
  const PAGE_SIZE = 100
  const [currentPage, setCurrentPage] = useState(1)
  useEffect(() => {
    setCurrentPage(1)
  }, [search, activeFilter, typeFilter, categoryFilter])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length)
  const pageRows = useMemo(
    () => filtered.slice(pageStart, pageEnd),
    [filtered, pageStart, pageEnd],
  )

  const typeMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of materialTypes) m[t.id] = t.name
    return m
  }, [materialTypes])

  const categoryMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of materialCategories) m[c.id] = c.name
    return m
  }, [materialCategories])

  function handleSave() {
    setFormError(null)
    startTransition(async () => {
      if (isNew) {
        const result = await createMaterial(orgId, orgSlug, form, vendors)
        if (result.error) setFormError(result.error)
        else { closeForm(); showToast('Material created'); router.refresh() }
      } else if (editingId) {
        const result = await updateMaterial(editingId, orgId, orgSlug, form, vendors)
        if (result.error) setFormError(result.error)
        else { closeForm(); showToast('Material updated'); router.refresh() }
      }
    })
  }

  function handleToggleActive(id: string, nextActive: boolean) {
    startTransition(async () => {
      const result = await toggleMaterialActive(id, orgId, orgSlug, nextActive)
      if (result.error) showToast(`Error: ${result.error}`)
      else { showToast(nextActive ? 'Activated' : 'Deactivated'); router.refresh() }
    })
  }

  // Vendor list helpers
  function addVendor() {
    setVendors((vs) => [...vs, emptyVendor()])
  }
  function updateVendor(i: number, patch: Partial<VendorRowInput>) {
    setVendors((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
  }
  function removeVendor(i: number) {
    setVendors((vs) => vs.filter((_, idx) => idx !== i))
  }
  function handleDrop(targetIdx: number) {
    if (dragIndex === null || dragIndex === targetIdx) {
      setDragIndex(null)
      return
    }
    setVendors((vs) => {
      const next = [...vs]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(targetIdx, 0, moved)
      return next
    })
    setDragIndex(null)
  }

  useEffect(() => {
    if (!isFormOpen) return
    function beforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [isFormOpen])

  return (
    <>
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-green-800">{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold text-qm-black">Materials</h1>
          <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2.5 py-0.5 text-xs font-semibold text-qm-lime-dark">
            {materials.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/${orgSlug}/settings/materials/import`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-black hover:bg-gray-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Import CSV
          </Link>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add New Material
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-qm-gray" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, external name, part number, SKU..."
            className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setCategoryFilter('all') }}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="all">All types</option>
          {materialTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="all">All categories</option>
          {filteredCategoriesForListFilter.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as 'all' | 'active' | 'inactive')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="all">All</option>
        </select>
      </div>

      {/* Table */}
      {materials.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No materials yet</p>
          <p className="mt-1 text-sm text-gray-500">Add your first material or import 1,764 from ShopVOX.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-qm-gray">No materials match your filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Category</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Cost</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Selling Units</th>
                <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-3">
                    <div className="text-sm font-semibold text-qm-black">{m.name}</div>
                    {m.external_name && <div className="text-xs text-qm-gray">{m.external_name}</div>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-qm-gray">{m.material_type_id ? typeMap[m.material_type_id] ?? '—' : <span className="text-gray-300">—</span>}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-qm-gray">{m.category_id ? categoryMap[m.category_id] ?? '—' : <span className="text-gray-300">—</span>}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-right text-sm text-qm-black">{formatMoney(m.cost)}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-right text-sm font-medium text-qm-black">{formatMoney(m.price)}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-qm-gray">{m.selling_units ?? <span className="text-gray-300">—</span>}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-center">
                    <button
                      onClick={() => handleToggleActive(m.id, !(m.active ?? true))}
                      disabled={isPending}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${m.active ? 'bg-qm-lime' : 'bg-gray-300'} disabled:opacity-50`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${m.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right">
                    <button onClick={() => openEdit(m)} className="text-sm font-medium text-qm-lime hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-2 text-xs text-qm-gray">
            <div>
              Showing <span className="font-semibold text-qm-black">{filtered.length === 0 ? 0 : pageStart + 1}</span>
              –<span className="font-semibold text-qm-black">{pageEnd}</span> of{' '}
              <span className="font-semibold text-qm-black">{filtered.length.toLocaleString()}</span> materials
              {filtered.length !== materials.length && (
                <span className="text-qm-gray"> (filtered from {materials.length.toLocaleString()})</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-qm-black hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="tabular-nums">
                Page {safePage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-qm-black hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide-over form */}
      {isFormOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => !isPending && closeForm()} />
          <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-3xl bg-white shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-bold text-qm-black">
                {isNew ? 'New Material' : `Edit: ${form.name || 'Material'}`}
              </h2>
              <button onClick={closeForm} disabled={isPending} className="rounded-md p-1 text-qm-gray hover:text-qm-black disabled:opacity-50">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tab strip */}
            <div className="border-b border-gray-200 bg-gray-50 px-2 flex gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors border-b-2 ${
                    activeTab === t.key
                      ? 'border-qm-lime text-qm-lime'
                      : 'border-transparent text-qm-gray hover:text-qm-black'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {formError && (
                <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{formError}</div>
              )}

              {/* DETAILS TAB */}
              {activeTab === 'details' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Name" required>
                      <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                    </Field>
                    <Field label="External Name">
                      <input type="text" value={form.external_name ?? ''} onChange={(e) => setForm({ ...form, external_name: e.target.value || null })} className={inputClass} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Material Type">
                      <select value={form.material_type_id ?? ''} onChange={(e) => setForm({ ...form, material_type_id: e.target.value || null, category_id: null })} className={inputClass}>
                        <option value="">—</option>
                        {materialTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Category">
                      <select value={form.category_id ?? ''} onChange={(e) => setForm({ ...form, category_id: e.target.value || null })} className={inputClass}>
                        <option value="">—</option>
                        {filteredCategoriesForForm.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Description (internal)">
                    <textarea value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value || null })} rows={3} className={inputClass} />
                  </Field>
                  <Field label="PO Description (what vendor sees)">
                    <textarea value={form.po_description ?? ''} onChange={(e) => setForm({ ...form, po_description: e.target.value || null })} rows={2} className={inputClass} />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Info URL (for reordering)">
                      <input type="url" value={form.info_url ?? ''} onChange={(e) => setForm({ ...form, info_url: e.target.value || null })} className={inputClass} />
                    </Field>
                    <Field label="Image URL">
                      <input type="url" value={form.image_url ?? ''} onChange={(e) => setForm({ ...form, image_url: e.target.value || null })} className={inputClass} />
                    </Field>
                  </div>
                  <div className="space-y-2">
                    <Toggle label="Show Internal" checked={form.show_internal} onChange={(v) => setForm({ ...form, show_internal: v })} />
                    <Toggle label="Show External (to customer)" checked={form.show_external} onChange={(v) => setForm({ ...form, show_external: v })} />
                    <Toggle label="Print Image on PDF" checked={form.print_image_on_pdf} onChange={(v) => setForm({ ...form, print_image_on_pdf: v })} />
                    <Toggle label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
                  </div>
                </div>
              )}

              {/* PRICING TAB */}
              {activeTab === 'pricing' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="Cost ($)">
                      <input type="number" step="0.01" value={form.cost} onChange={(e) => setCost(parseFloat(e.target.value) || 0)} className={inputClass} />
                    </Field>
                    <Field label="Multiplier (×)">
                      <input type="number" step="0.01" value={form.multiplier} onChange={(e) => setMultiplier(parseFloat(e.target.value) || 0)} className={inputClass} />
                    </Field>
                    <Field label="Price ($)">
                      <input type="number" step="0.01" value={form.price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} className={inputClass} />
                    </Field>
                  </div>
                  <div className="rounded-lg bg-qm-lime-light px-4 py-2 text-sm">
                    <span className="text-qm-lime-dark font-semibold">Profit Margin:</span>{' '}
                    <span className="text-qm-black font-bold">{profitMargin ?? '—'}%</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Selling Units">
                      <select value={form.selling_units ?? ''} onChange={(e) => setForm({ ...form, selling_units: e.target.value || null })} className={inputClass}>
                        <option value="">—</option>
                        {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </Field>
                    <Field label="Buying Units">
                      <select value={form.buying_units ?? ''} onChange={(e) => setForm({ ...form, buying_units: e.target.value || null })} className={inputClass}>
                        <option value="">—</option>
                        {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Sell/Buy Ratio">
                      <input type="number" step="0.01" value={form.sell_buy_ratio ?? ''} onChange={(e) => setForm({ ...form, sell_buy_ratio: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Conversion Factor">
                      <input type="number" step="0.01" value={form.conversion_factor ?? ''} onChange={(e) => setForm({ ...form, conversion_factor: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                  </div>
                  <Field label="Per LI Unit">
                    <input type="text" value={form.per_li_unit ?? ''} onChange={(e) => setForm({ ...form, per_li_unit: e.target.value || null })} className={inputClass} />
                  </Field>
                  <div className="grid grid-cols-4 gap-4">
                    <Field label="Setup Charge">
                      <input type="number" step="0.01" value={form.setup_charge ?? ''} onChange={(e) => setForm({ ...form, setup_charge: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Labor Charge">
                      <input type="number" step="0.01" value={form.labor_charge ?? ''} onChange={(e) => setForm({ ...form, labor_charge: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Machine Charge">
                      <input type="number" step="0.01" value={form.machine_charge ?? ''} onChange={(e) => setForm({ ...form, machine_charge: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Other Charge">
                      <input type="number" step="0.01" value={form.other_charge ?? ''} onChange={(e) => setForm({ ...form, other_charge: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Formula">
                      <select value={form.formula ?? ''} onChange={(e) => setForm({ ...form, formula: e.target.value || null })} className={inputClass}>
                        <option value="">—</option>
                        {FORMULA_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </Field>
                    <Field label="Linked Discount">
                      <select value={form.discount_id ?? ''} onChange={(e) => setForm({ ...form, discount_id: e.target.value || null })} className={inputClass}>
                        <option value="">—</option>
                        {discounts.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Percentage of Base (%)">
                    <input type="number" step="0.01" value={form.percentage_of_base ?? ''} onChange={(e) => setForm({ ...form, percentage_of_base: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                  </Field>
                  <Toggle label="Include in Base Price" checked={form.include_in_base_price} onChange={(v) => setForm({ ...form, include_in_base_price: v })} />
                </div>
              )}

              {/* PACKAGE TAB */}
              {activeTab === 'package' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Width (inches)">
                      <input type="number" step="0.01" value={form.width ?? ''} onChange={(e) => setForm({ ...form, width: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Height / Length (inches)">
                      <input type="number" step="0.01" value={form.height ?? ''} onChange={(e) => setForm({ ...form, height: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                  </div>
                  <Field label="Fixed Side">
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name="fixed_side" checked={form.fixed_side === 'Width'} onChange={() => setForm({ ...form, fixed_side: 'Width' })} className="accent-qm-lime" />
                        Width
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name="fixed_side" checked={form.fixed_side === 'Height'} onChange={() => setForm({ ...form, fixed_side: 'Height' })} className="accent-qm-lime" />
                        Height
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name="fixed_side" checked={form.fixed_side === null} onChange={() => setForm({ ...form, fixed_side: null })} className="accent-qm-lime" />
                        None
                      </label>
                    </div>
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Fixed Quantity">
                      <input type="number" step="1" value={form.fixed_quantity ?? ''} onChange={(e) => setForm({ ...form, fixed_quantity: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Sheet Cost">
                      <input type="number" step="0.01" value={form.sheet_cost ?? ''} onChange={(e) => setForm({ ...form, sheet_cost: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Weight">
                      <input type="number" step="0.01" value={form.weight ?? ''} onChange={(e) => setForm({ ...form, weight: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Weight UOM">
                      <select value={form.weight_uom ?? ''} onChange={(e) => setForm({ ...form, weight_uom: e.target.value || null })} className={inputClass}>
                        <option value="">—</option>
                        {WEIGHT_UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>
              )}

              {/* WASTAGE TAB */}
              {activeTab === 'wastage' && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                    <p className="font-semibold mb-1">About wastage</p>
                    <p className="text-blue-700">
                      Wastage charges the customer for material lost during production. Example: a
                      banner printed on a 54in roll where the job is 48in wide means 6in of waste
                      per linear foot.
                    </p>
                  </div>
                  <Toggle label="Calculate Wastage" checked={form.calculate_wastage} onChange={(v) => setForm({ ...form, calculate_wastage: v })} />
                  <Field label="Wastage Markup (%)">
                    <input type="number" step="0.1" value={form.wastage_markup ?? ''} onChange={(e) => setForm({ ...form, wastage_markup: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                  </Field>
                  <Toggle label="Allow Variants" checked={form.allow_variants} onChange={(v) => setForm({ ...form, allow_variants: v })} />
                </div>
              )}

              {/* INVENTORY TAB */}
              {activeTab === 'inventory' && (
                <div className="space-y-4">
                  <Toggle label="Track Inventory" checked={form.track_inventory} onChange={(v) => setForm({ ...form, track_inventory: v })} />
                  <Toggle label="In Use" checked={form.in_use} onChange={(v) => setForm({ ...form, in_use: v })} />
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-qm-gray">
                    <p>Stock levels (min, max, current) are managed per-vendor on the Vendor Pricing tab.</p>
                  </div>
                </div>
              )}

              {/* ACCOUNTING TAB */}
              {activeTab === 'accounting' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="COG Account Name">
                      <input type="text" value={form.cog_account_name ?? ''} onChange={(e) => setForm({ ...form, cog_account_name: e.target.value || null })} className={inputClass} />
                    </Field>
                    <Field label="COG Account Number">
                      <input type="number" value={form.cog_account_number ?? ''} onChange={(e) => setForm({ ...form, cog_account_number: e.target.value === '' ? null : parseInt(e.target.value) })} className={inputClass} />
                    </Field>
                  </div>
                  <Field label="QB Item Type">
                    <select value={form.qb_item_type ?? ''} onChange={(e) => setForm({ ...form, qb_item_type: e.target.value || null })} className={inputClass}>
                      <option value="">—</option>
                      {QB_ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                </div>
              )}

              {/* VENDORS TAB */}
              {activeTab === 'vendors' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-qm-gray">Drag rows to reorder. Rank 1 is the preferred vendor.</p>
                    <button
                      onClick={addVendor}
                      className="inline-flex items-center gap-1 rounded-md bg-qm-lime px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Add Vendor
                    </button>
                  </div>
                  {vendors.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-qm-gray">
                      No vendors yet. Click &quot;Add Vendor&quot; to get started.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {vendors.map((v, i) => (
                        <div
                          key={i}
                          draggable
                          onDragStart={() => setDragIndex(i)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleDrop(i)}
                          className={`rounded-lg border bg-white p-4 ${dragIndex === i ? 'opacity-50' : ''} ${i === 0 ? 'border-qm-lime' : 'border-gray-200'}`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="cursor-grab text-qm-gray" title="Drag to reorder">
                                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path d="M7 2a1 1 0 000 2h1v12H7a1 1 0 100 2h6a1 1 0 100-2h-1V4h1a1 1 0 100-2H7z" /></svg>
                              </span>
                              <span className="text-xs font-bold text-qm-gray">Rank {i + 1}</span>
                              {i === 0 && (
                                <span className="inline-flex items-center rounded-full bg-qm-lime px-2 py-0.5 text-xs font-bold text-white">Preferred</span>
                              )}
                            </div>
                            <button onClick={() => removeVendor(i)} className="text-red-500 hover:text-red-700 text-sm">Remove</button>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Vendor Name">
                              <input type="text" value={v.vendor_name} onChange={(e) => updateVendor(i, { vendor_name: e.target.value })} className={inputClass} />
                            </Field>
                            <Field label="Price ($)">
                              <input type="number" step="0.01" value={v.vendor_price} onChange={(e) => updateVendor(i, { vendor_price: parseFloat(e.target.value) || 0 })} className={inputClass} />
                            </Field>
                            <Field label="Buying Units">
                              <select value={v.buying_units ?? ''} onChange={(e) => updateVendor(i, { buying_units: e.target.value || null })} className={inputClass}>
                                <option value="">—</option>
                                {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                              </select>
                            </Field>
                            <Field label="Length per Unit">
                              <input type="number" step="0.01" value={v.length_per_unit ?? ''} onChange={(e) => updateVendor(i, { length_per_unit: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                            </Field>
                            <Field label="Part Name">
                              <input type="text" value={v.part_name ?? ''} onChange={(e) => updateVendor(i, { part_name: e.target.value || null })} className={inputClass} />
                            </Field>
                            <Field label="Part Number">
                              <input type="text" value={v.part_number ?? ''} onChange={(e) => updateVendor(i, { part_number: e.target.value || null })} className={inputClass} />
                            </Field>
                            <Field label="Delivery Fee ($)">
                              <input type="number" step="0.01" value={v.delivery_fee ?? ''} onChange={(e) => updateVendor(i, { delivery_fee: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                            </Field>
                            <Field label="Min Order Value ($)">
                              <input type="number" step="0.01" value={v.min_order_value ?? ''} onChange={(e) => updateVendor(i, { min_order_value: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                            </Field>
                            <Field label="Min Stock Level">
                              <input type="number" step="1" value={v.min_stock_level ?? ''} onChange={(e) => updateVendor(i, { min_stock_level: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                            </Field>
                            <Field label="Max Stock Level">
                              <input type="number" step="1" value={v.max_stock_level ?? ''} onChange={(e) => updateVendor(i, { max_stock_level: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                            </Field>
                          </div>
                          <div className="mt-3">
                            <Toggle label="Active" checked={v.active} onChange={(vv) => updateVendor(i, { active: vv })} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* REMNANTS TAB */}
              {activeTab === 'remnants' && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-qm-lime/30 bg-qm-lime-light p-4 text-sm text-qm-lime-dark">
                    <p className="font-semibold mb-1">PrintOS-only feature</p>
                    <p>
                      Remnant pieces appear in the quote builder when a job could use leftover
                      material. This reduces waste and lowers material cost automatically.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Remnant Width (inches)">
                      <input type="number" step="0.01" value={form.remnant_width ?? ''} onChange={(e) => setForm({ ...form, remnant_width: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Remnant Length (inches)">
                      <input type="number" step="0.01" value={form.remnant_length ?? ''} onChange={(e) => setForm({ ...form, remnant_length: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                  </div>
                  <Field label="Location (shelf / bin / rack)">
                    <input type="text" value={form.remnant_location ?? ''} onChange={(e) => setForm({ ...form, remnant_location: e.target.value || null })} className={inputClass} />
                  </Field>
                  <Toggle label="Usable" checked={form.remnant_usable} onChange={(v) => setForm({ ...form, remnant_usable: v })} />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex items-center justify-end gap-3">
              <button onClick={closeForm} disabled={isPending} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={isPending} className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {isPending ? 'Saving...' : isNew ? 'Create Material' : 'Save Changes'}
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  )
}

// ---- Helpers ----

const inputClass = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-qm-lime' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

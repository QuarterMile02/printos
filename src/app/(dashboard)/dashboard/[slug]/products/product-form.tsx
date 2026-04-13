'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type {
  Product, ProductCategory, WorkflowTemplate, ProductStatus,
  PricingFormula, Discount, Material, LaborRate, MachineRate, Modifier,
  ProductDefaultItem, ProductModifier, ProductCustomField,
} from '@/types/product-builder'
import {
  createProduct, updateProduct,
  type ProductFormData,
  type DefaultItemInput, type ProductModifierInput,
  type DropdownItemInput,
  type ProductCustomFieldInput,
} from './actions'

type MaterialOption = Pick<Material, 'id' | 'name' | 'cost' | 'price' | 'selling_units' | 'material_type_id' | 'category_id' | 'active'>
type LaborRateOption = Pick<LaborRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>
type MachineRateOption = Pick<MachineRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>

export type ExistingDropdownMenu = {
  menu_name: string
  is_optional: boolean
  items: DropdownItemInput[]
}

type Props = {
  orgId: string
  orgSlug: string
  product: Product | null
  categories: ProductCategory[]
  workflows: WorkflowTemplate[]
  pricingFormulas: PricingFormula[]
  discounts: Discount[]
  materials: MaterialOption[]
  laborRates: LaborRateOption[]
  machineRates: MachineRateOption[]
  modifiersList: Modifier[]
  existingDefaultItems: ProductDefaultItem[]
  existingModifiers: ProductModifier[]
  existingDropdownMenus: ExistingDropdownMenu[]
  existingCustomFields: ProductCustomField[]
}

type TabKey = 'basic' | 'advanced' | 'pricing' | 'custom-fields'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'basic', label: 'Basic' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'advanced', label: 'Modifiers' },
  { key: 'custom-fields', label: 'Custom Fields' },
]

const STATUS_OPTIONS: { value: ProductStatus; label: string; style: string }[] = [
  { value: 'draft',     label: 'Draft',     style: 'bg-qm-gray-light text-qm-gray border-qm-gray' },
  { value: 'published', label: 'Published', style: 'bg-qm-lime-light text-qm-lime-dark border-qm-lime' },
  { value: 'disabled',  label: 'Disabled',  style: 'bg-red-50 text-red-700 border-red-300' },
  { value: 'archived',  label: 'Archived',  style: 'bg-qm-black/5 text-qm-gray border-gray-300' },
]

const COMPLEXITY_LABELS: Record<number, string> = {
  1: 'Simple', 2: 'Easy', 3: 'Standard', 4: 'Complex', 5: 'Expert',
}

const UNIT_OPTIONS = ['Each', 'Sqft', 'Roll', 'Sheet', 'Unit', 'Feet', 'Inch', 'Yard', 'Hr']

// ---- Client-side enriched row types (include display labels) ----
type RecipeRow = DefaultItemInput & { display_name: string }
type ModifierRow = ProductModifierInput & { display_name: string; modifier_type: string }
type DropdownMenuRow = {
  menu_name: string
  is_optional: boolean
  items: (DropdownItemInput & { display_name: string; type_label: string })[]
}

function emptyForm(): ProductFormData {
  return {
    // Tab 1
    name: '', description: null, product_type: null, category_id: null,
    secondary_category: null, workflow_template_id: null, complexity_value: 3,
    image_url: null, status: 'draft',
    // Tab 2
    income_account: null, income_account_number: null, cog_account: null,
    cog_account_number: null, asset_account: null,
    default_sale_type: 'In House', qb_item_type: null, rounding: 2,
    taxable: true, in_house_commission: false, outsourced_commission: false,
    include_base_product_in_po: false, print_image_on_pdf: false,
    production_details: null,
    // Tab 3
    pricing_type: 'Formula', pricing_method: 'Standard', formula: null,
    show_feet_inches: false, buying_cost: null, buying_units: null,
    conversion_factor: null, units: null,
    cost: 0, markup: 1, price: 0,
    min_line_price: null, min_unit_price: null,
    volume_discount_id: null, range_discount_id: null,
  }
}

function toFormData(p: Product): ProductFormData {
  return {
    name: p.name, description: p.description, product_type: p.product_type,
    category_id: p.category_id, secondary_category: p.secondary_category,
    workflow_template_id: p.workflow_template_id, complexity_value: p.complexity_value ?? 3,
    image_url: p.image_url, status: p.status ?? 'draft',
    income_account: p.income_account, income_account_number: p.income_account_number,
    cog_account: p.cog_account, cog_account_number: p.cog_account_number,
    asset_account: p.asset_account, default_sale_type: p.default_sale_type ?? 'In House',
    qb_item_type: p.qb_item_type, rounding: p.rounding ?? 2,
    taxable: p.taxable ?? true,
    in_house_commission: p.in_house_commission ?? false,
    outsourced_commission: p.outsourced_commission ?? false,
    include_base_product_in_po: p.include_base_product_in_po ?? false,
    print_image_on_pdf: p.print_image_on_pdf ?? false,
    production_details: p.production_details,
    pricing_type: (p.pricing_type as 'Formula' | 'Basic' | 'Grid') ?? 'Formula',
    pricing_method: p.pricing_method ?? 'Standard',
    formula: p.formula, show_feet_inches: p.show_feet_inches ?? false,
    buying_cost: p.buying_cost, buying_units: p.buying_units,
    conversion_factor: p.conversion_factor, units: p.units,
    cost: Number(p.cost ?? 0), markup: Number(p.markup ?? 1), price: Number(p.price ?? 0),
    min_line_price: p.min_line_price, min_unit_price: p.min_unit_price,
    volume_discount_id: p.volume_discount_id, range_discount_id: p.range_discount_id,
  }
}

export default function ProductForm({
  orgId, orgSlug, product,
  categories, workflows, pricingFormulas, discounts,
  materials, laborRates, machineRates, modifiersList,
  existingDefaultItems, existingModifiers, existingDropdownMenus, existingCustomFields,
}: Props) {
  const router = useRouter()
  const isNew = product === null
  const [activeTab, setActiveTab] = useState<TabKey>('basic')
  const [form, setForm] = useState<ProductFormData>(product ? toFormData(product) : emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  // Lookup maps for display names
  const materialMap = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials])
  const laborMap = useMemo(() => new Map(laborRates.map((l) => [l.id, l])), [laborRates])
  const machineMap = useMemo(() => new Map(machineRates.map((m) => [m.id, m])), [machineRates])
  const modifierMap = useMemo(() => new Map(modifiersList.map((m) => [m.id, m])), [modifiersList])

  function defaultItemDisplay(row: DefaultItemInput): { display_name: string } {
    if (row.item_type === 'Material' && row.material_id) {
      return { display_name: materialMap.get(row.material_id)?.name ?? 'Unknown material' }
    }
    if (row.item_type === 'LaborRate' && row.labor_rate_id) {
      return { display_name: laborMap.get(row.labor_rate_id)?.name ?? 'Unknown labor rate' }
    }
    if (row.item_type === 'MachineRate' && row.machine_rate_id) {
      return { display_name: machineMap.get(row.machine_rate_id)?.name ?? 'Unknown machine rate' }
    }
    return { display_name: row.custom_item_name ?? 'Custom' }
  }

  function dropdownItemDisplay(row: DropdownItemInput): { display_name: string; type_label: string } {
    if (row.item_type === 'Material' && row.material_id) {
      return { display_name: materialMap.get(row.material_id)?.name ?? '—', type_label: 'Material' }
    }
    if (row.item_type === 'LaborRate' && row.labor_rate_id) {
      return { display_name: laborMap.get(row.labor_rate_id)?.name ?? '—', type_label: 'Labor' }
    }
    if (row.item_type === 'MachineRate' && row.machine_rate_id) {
      return { display_name: machineMap.get(row.machine_rate_id)?.name ?? '—', type_label: 'Machine' }
    }
    return { display_name: '—', type_label: '—' }
  }

  // Initial state — split existing default items into the three recipe groups
  function buildRecipeRows(filterType: DefaultItemInput['item_type']): RecipeRow[] {
    return existingDefaultItems
      .filter((r) => (r.item_type ?? 'Material') === filterType)
      .map((r) => {
        const base: DefaultItemInput = {
          item_type: (r.item_type as DefaultItemInput['item_type']) ?? 'Material',
          material_id: r.material_id,
          labor_rate_id: r.labor_rate_id,
          machine_rate_id: r.machine_rate_id,
          custom_item_name: r.custom_item_name,
          menu_name: r.menu_name,
          system_formula: r.system_formula,
          charge_per_li_unit: r.charge_per_li_unit ?? false,
          include_in_base_price: r.include_in_base_price ?? false,
          is_optional: r.is_optional ?? false,
          multiplier: r.multiplier,
        }
        return { ...base, ...defaultItemDisplay(base) }
      })
  }

  const [recipeMaterials, setRecipeMaterials] = useState<RecipeRow[]>(() => buildRecipeRows('Material'))
  const [recipeLabor, setRecipeLabor] = useState<RecipeRow[]>(() => buildRecipeRows('LaborRate'))
  const [recipeMachine, setRecipeMachine] = useState<RecipeRow[]>(() => buildRecipeRows('MachineRate'))

  const [modifierRows, setModifierRows] = useState<ModifierRow[]>(() =>
    existingModifiers
      .filter((m) => m.modifier_id)
      .map((m) => {
        const mod = modifierMap.get(m.modifier_id!)
        return {
          modifier_id: m.modifier_id!,
          is_required: m.is_required ?? false,
          default_value: m.default_value,
          display_name: mod?.display_name ?? 'Unknown modifier',
          modifier_type: mod?.modifier_type ?? '',
        }
      })
  )

  const [dropdownMenus, setDropdownMenus] = useState<DropdownMenuRow[]>(() =>
    existingDropdownMenus.map((menu) => ({
      menu_name: menu.menu_name,
      is_optional: menu.is_optional,
      items: menu.items.map((i) => ({ ...i, ...dropdownItemDisplay(i) })),
    }))
  )

  const [customFields, setCustomFields] = useState<ProductCustomFieldInput[]>(() =>
    existingCustomFields.map((f) => ({
      field_name: f.field_name,
      field_type: (f.field_type ?? 'text') as ProductCustomFieldInput['field_type'],
      is_required: f.is_required ?? false,
      print_on_customer_pdf: f.print_on_customer_pdf ?? false,
      print_on_po: f.print_on_po ?? false,
    }))
  )

  const [expandedMenus, setExpandedMenus] = useState<Set<number>>(new Set([0]))
  const [materialDragIndex, setMaterialDragIndex] = useState<number | null>(null)

  // ---- Search modal state ----
  type SearchTarget =
    | { kind: 'recipe'; itemType: 'Material' | 'LaborRate' | 'MachineRate' }
    | { kind: 'dropdown-item'; menuIdx: number }
  const [searchModal, setSearchModal] = useState<SearchTarget | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCategory, setSearchCategory] = useState<'Material' | 'LaborRate' | 'MachineRate'>('Material')

  // ---- Modifier picker state ----
  const [modifierPickerOpen, setModifierPickerOpen] = useState(false)
  const [modifierSearch, setModifierSearch] = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  // Triangle auto-calc
  function setCost(cost: number) {
    setForm((f) => ({ ...f, cost, price: Number((cost * f.markup).toFixed(2)) }))
  }
  function setPrice(price: number) {
    setForm((f) => ({ ...f, price, markup: f.cost > 0 ? Number((price / f.cost).toFixed(4)) : f.markup }))
  }
  function setMarkup(markup: number) {
    setForm((f) => ({ ...f, markup, price: Number((f.cost * markup).toFixed(2)) }))
  }

  const profitMargin = useMemo(() => {
    if (form.price <= 0) return null
    return ((form.price - form.cost) / form.price * 100).toFixed(2)
  }, [form.cost, form.price])

  function handleSave() {
    setFormError(null)
    startTransition(async () => {
      const stripDisplay = (rows: RecipeRow[]) =>
        rows.map(({ display_name: _d, ...rest }) => { void _d; return rest })
      const bundle = {
        product: form,
        defaultItems: [
          ...stripDisplay(recipeMaterials),
          ...stripDisplay(recipeLabor),
          ...stripDisplay(recipeMachine),
        ],
        modifiers: modifierRows.map(({ display_name: _d, modifier_type: _mt, ...rest }) => {
          void _d; void _mt
          return rest
        }),
        dropdownMenus: dropdownMenus.map((menu) => ({
          menu_name: menu.menu_name,
          is_optional: menu.is_optional,
          items: menu.items.map(({ display_name: _d, type_label: _t, ...rest }) => {
            void _d; void _t
            return rest
          }),
        })),
        customFields,
      }

      if (isNew) {
        const result = await createProduct(orgId, orgSlug, bundle)
        if (result.error) setFormError(result.error)
        else if (result.id) router.push(`/dashboard/${orgSlug}/products/${result.id}`)
      } else if (product) {
        const result = await updateProduct(product.id, orgId, orgSlug, bundle)
        if (result.error) setFormError(result.error)
        else { showToast('Product saved'); router.refresh() }
      }
    })
  }

  // ---- Recipe (Material / Labor / Machine) actions ----
  function openSearchForRecipe(itemType: 'Material' | 'LaborRate' | 'MachineRate') {
    setSearchModal({ kind: 'recipe', itemType })
    setSearchCategory(itemType)
    setSearchQuery('')
  }

  function makeRecipeRow(
    itemType: 'Material' | 'LaborRate' | 'MachineRate',
    item: { id: string; name: string; formula?: string | null }
  ): RecipeRow {
    const base: DefaultItemInput = {
      item_type: itemType,
      material_id: itemType === 'Material' ? item.id : null,
      labor_rate_id: itemType === 'LaborRate' ? item.id : null,
      machine_rate_id: itemType === 'MachineRate' ? item.id : null,
      custom_item_name: null,
      menu_name: null,
      system_formula: item.formula ?? null,
      charge_per_li_unit: itemType !== 'Material',
      include_in_base_price: true,
      is_optional: false,
      multiplier: 1,
    }
    return { ...base, ...defaultItemDisplay(base) }
  }

  function addRecipeFromSearch(item: { id: string; name: string; formula?: string | null }) {
    if (!searchModal || searchModal.kind !== 'recipe') return
    const row = makeRecipeRow(searchModal.itemType, item)
    if (searchModal.itemType === 'Material') setRecipeMaterials((rows) => [...rows, row])
    else if (searchModal.itemType === 'LaborRate') setRecipeLabor((rows) => [...rows, row])
    else setRecipeMachine((rows) => [...rows, row])
    setSearchModal(null)
  }

  function updateRecipeRow(
    setter: React.Dispatch<React.SetStateAction<RecipeRow[]>>,
    i: number,
    patch: Partial<DefaultItemInput>,
  ) {
    setter((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function removeRecipeRow(setter: React.Dispatch<React.SetStateAction<RecipeRow[]>>, i: number) {
    setter((rows) => rows.filter((_, idx) => idx !== i))
  }
  function handleMaterialDrop(targetIdx: number) {
    if (materialDragIndex === null || materialDragIndex === targetIdx) {
      setMaterialDragIndex(null)
      return
    }
    setRecipeMaterials((rows) => {
      const next = [...rows]
      const [moved] = next.splice(materialDragIndex, 1)
      next.splice(targetIdx, 0, moved)
      return next
    })
    setMaterialDragIndex(null)
  }

  // ---- Modifier actions ----
  function addModifierFromPicker(mod: Modifier) {
    if (modifierRows.some((r) => r.modifier_id === mod.id)) {
      showToast('Modifier already added')
      return
    }
    const row: ModifierRow = {
      modifier_id: mod.id,
      is_required: false,
      default_value: null,
      display_name: mod.display_name,
      modifier_type: mod.modifier_type,
    }
    setModifierRows((rows) => [...rows, row])
    setModifierPickerOpen(false)
  }
  function updateModifierRow(i: number, patch: Partial<ProductModifierInput>) {
    setModifierRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function removeModifierRow(i: number) {
    setModifierRows((rows) => rows.filter((_, idx) => idx !== i))
  }
  function moveModifierRow(i: number, dir: -1 | 1) {
    setModifierRows((rows) => {
      const j = i + dir
      if (j < 0 || j >= rows.length) return rows
      const next = [...rows]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // ---- Dropdown menu actions ----
  function addMenu() {
    setDropdownMenus((menus) => [...menus, { menu_name: '', is_optional: false, items: [] }])
    setExpandedMenus((s) => new Set([...s, dropdownMenus.length]))
  }
  function updateMenu(i: number, patch: Partial<Pick<DropdownMenuRow, 'menu_name' | 'is_optional'>>) {
    setDropdownMenus((menus) => menus.map((m, idx) => (idx === i ? { ...m, ...patch } : m)))
  }
  function removeMenu(i: number) {
    setDropdownMenus((menus) => menus.filter((_, idx) => idx !== i))
  }
  function moveMenu(i: number, dir: -1 | 1) {
    setDropdownMenus((menus) => {
      const j = i + dir
      if (j < 0 || j >= menus.length) return menus
      const next = [...menus]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function toggleMenuExpanded(i: number) {
    setExpandedMenus((s) => {
      const next = new Set(s)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  function openSearchForDropdownItem(menuIdx: number) {
    setSearchModal({ kind: 'dropdown-item', menuIdx })
    setSearchQuery('')
  }
  function addDropdownItemFromSearch(kind: 'Material' | 'LaborRate' | 'MachineRate', item: { id: string; name: string }) {
    if (!searchModal || searchModal.kind !== 'dropdown-item') return
    const menuIdx = searchModal.menuIdx
    const base: DropdownItemInput = {
      item_type: kind,
      material_id: kind === 'Material' ? item.id : null,
      labor_rate_id: kind === 'LaborRate' ? item.id : null,
      machine_rate_id: kind === 'MachineRate' ? item.id : null,
      system_formula: null,
      charge_per_li_unit: true,
      is_optional: false,
    }
    const row = { ...base, ...dropdownItemDisplay(base) }
    setDropdownMenus((menus) =>
      menus.map((m, idx) => (idx === menuIdx ? { ...m, items: [...m.items, row] } : m))
    )
    setSearchModal(null)
  }
  function removeDropdownItem(menuIdx: number, itemIdx: number) {
    setDropdownMenus((menus) =>
      menus.map((m, idx) => (idx === menuIdx ? { ...m, items: m.items.filter((_, i) => i !== itemIdx) } : m))
    )
  }

  // ---- Custom field actions ----
  function addCustomField() {
    setCustomFields((rows) => [
      ...rows,
      { field_name: '', field_type: 'text', is_required: false, print_on_customer_pdf: false, print_on_po: false },
    ])
  }
  function updateCustomField(i: number, patch: Partial<ProductCustomFieldInput>) {
    setCustomFields((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function removeCustomField(i: number) {
    setCustomFields((rows) => rows.filter((_, idx) => idx !== i))
  }
  function moveCustomField(i: number, dir: -1 | 1) {
    setCustomFields((rows) => {
      const j = i + dir
      if (j < 0 || j >= rows.length) return rows
      const next = [...rows]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // ---- Search results ----
  const searchResults = useMemo(() => {
    const term = searchQuery.trim().toLowerCase()
    if (searchCategory === 'Material') {
      return materials.filter((m) => !term || m.name.toLowerCase().includes(term)).slice(0, 50)
    }
    if (searchCategory === 'LaborRate') {
      return laborRates.filter((l) => !term || l.name.toLowerCase().includes(term)).slice(0, 50)
    }
    return machineRates.filter((mr) => !term || mr.name.toLowerCase().includes(term)).slice(0, 50)
  }, [searchCategory, searchQuery, materials, laborRates, machineRates])

  const modifierResults = useMemo(() => {
    const term = modifierSearch.trim().toLowerCase()
    return modifiersList.filter((m) => !term || m.display_name.toLowerCase().includes(term)).slice(0, 50)
  }, [modifierSearch, modifiersList])

  return (
    <>
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-green-800">{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
          <a href={`/dashboard/${orgSlug}/products`} className="hover:text-gray-700">Products</a>
          <span>/</span>
          <span className="text-gray-700">{isNew ? 'New Product' : product?.name || 'Product'}</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <a href={`/dashboard/${orgSlug}/products`} className="inline-flex items-center gap-1.5 text-sm font-medium text-qm-gray hover:text-qm-black mb-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back to Products
            </a>
            <h1 className="text-2xl font-extrabold text-qm-black">
              {isNew ? 'New Product' : (form.name || 'Untitled Product')}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => router.push(`/dashboard/${orgSlug}/products`)} disabled={isPending} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={handleSave} disabled={isPending} className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
              {isPending ? 'Saving...' : isNew ? 'Create Product' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {formError && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{formError}</div>
      )}

      {/* Tab strip */}
      <div className="mb-6 border-b border-gray-200 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-5 py-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === t.key ? 'border-qm-lime text-qm-lime' : 'border-transparent text-qm-gray hover:text-qm-black'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
        {activeTab === 'basic' && (
          <div className="space-y-5 max-w-3xl">
            <Field label="Product Name" required>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="e.g. Banner 13oz" />
            </Field>
            <Field label="Description">
              <textarea value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value || null })} rows={4} className={inputClass} placeholder="Detailed product description" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Type / Unit of Business">
                <input type="text" value={form.product_type ?? ''} onChange={(e) => setForm({ ...form, product_type: e.target.value || null })} className={inputClass} placeholder="e.g. Large Format Print" />
              </Field>
              <Field label="Workflow Template">
                <select value={form.workflow_template_id ?? ''} onChange={(e) => setForm({ ...form, workflow_template_id: e.target.value || null })} className={inputClass}>
                  <option value="">— None —</option>
                  {workflows.filter((w) => w.active !== false).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Category">
                <select value={form.category_id ?? ''} onChange={(e) => setForm({ ...form, category_id: e.target.value || null })} className={inputClass}>
                  <option value="">— None —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Secondary Category">
                <input type="text" value={form.secondary_category ?? ''} onChange={(e) => setForm({ ...form, secondary_category: e.target.value || null })} className={inputClass} placeholder="Optional" />
              </Field>
            </div>
            <Field label="Product Image URL">
              <input type="url" value={form.image_url ?? ''} onChange={(e) => setForm({ ...form, image_url: e.target.value || null })} className={inputClass} placeholder="https://..." />
              {form.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.image_url} alt="Preview" className="mt-2 h-24 w-24 rounded-md object-cover border border-gray-200" />
              )}
            </Field>
            <Field label={`Complexity: ${form.complexity_value ?? 3} — ${COMPLEXITY_LABELS[form.complexity_value ?? 3]}`}>
              <input type="range" min={1} max={5} step={1} value={form.complexity_value ?? 3} onChange={(e) => setForm({ ...form, complexity_value: parseInt(e.target.value) })} className="w-full accent-qm-lime" />
              <div className="flex justify-between text-xs text-qm-gray mt-1">
                <span>1 Simple</span><span>3 Standard</span><span>5 Expert</span>
              </div>
            </Field>
            <Field label="Status">
              <div className="grid grid-cols-4 gap-2">
                {STATUS_OPTIONS.map((s) => (
                  <label key={s.value} className={`flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 cursor-pointer transition-all ${form.status === s.value ? s.style + ' font-semibold' : 'border-gray-200 text-qm-gray hover:bg-gray-50'}`}>
                    <input type="radio" checked={form.status === s.value} onChange={() => setForm({ ...form, status: s.value })} className="sr-only" />
                    <span className="text-sm">{s.label}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="space-y-6 max-w-3xl">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-qm-gray border-b border-gray-200 pb-1 mb-3">Accounts</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Income Account"><input type="text" value={form.income_account ?? ''} onChange={(e) => setForm({ ...form, income_account: e.target.value || null })} className={inputClass} placeholder="e.g. Sales — Print Services" /></Field>
                  <Field label="Income Account Number"><input type="text" value={form.income_account_number ?? ''} onChange={(e) => setForm({ ...form, income_account_number: e.target.value || null })} className={inputClass} placeholder="e.g. 4100" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="COG Account"><input type="text" value={form.cog_account ?? ''} onChange={(e) => setForm({ ...form, cog_account: e.target.value || null })} className={inputClass} placeholder="e.g. Cost of Goods Sold" /></Field>
                  <Field label="COG Account Number"><input type="number" step="1" value={form.cog_account_number ?? ''} onChange={(e) => setForm({ ...form, cog_account_number: e.target.value === '' ? null : parseInt(e.target.value) })} className={inputClass} placeholder="e.g. 5000" /></Field>
                </div>
                <Field label="Asset Account"><input type="text" value={form.asset_account ?? ''} onChange={(e) => setForm({ ...form, asset_account: e.target.value || null })} className={inputClass} placeholder="e.g. Inventory Asset" /></Field>
              </div>
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-qm-gray border-b border-gray-200 pb-1 mb-3">Sales &amp; QuickBooks Desktop</h3>
              <div className="space-y-4">
                <Field label="Default Sale Type">
                  <div className="flex gap-4">
                    {(['In House', 'Outsourced'] as const).map((t) => (
                      <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="radio" checked={form.default_sale_type === t} onChange={() => setForm({ ...form, default_sale_type: t })} className="accent-qm-lime" />{t}
                      </label>
                    ))}
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="QB Item Type">
                    <select value={form.qb_item_type ?? ''} onChange={(e) => setForm({ ...form, qb_item_type: e.target.value || null })} className={inputClass}>
                      <option value="">—</option>
                      <option value="Inventory">Inventory</option>
                      <option value="Non-Inventory">Non-Inventory</option>
                      <option value="Service">Service</option>
                    </select>
                  </Field>
                  <Field label="Rounding (decimal places)">
                    <input type="number" step="1" min={0} max={6} value={form.rounding ?? 2} onChange={(e) => setForm({ ...form, rounding: e.target.value === '' ? null : parseInt(e.target.value) })} className={inputClass} />
                  </Field>
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-qm-gray border-b border-gray-200 pb-1 mb-3">Behavior</h3>
              <div className="space-y-2">
                <Toggle label="Taxable" checked={form.taxable} onChange={(v) => setForm({ ...form, taxable: v })} />
                <Toggle label="Pay Commissions on In-House Sales" checked={form.in_house_commission} onChange={(v) => setForm({ ...form, in_house_commission: v })} />
                <Toggle label="Pay Commissions on Outsourced Sales" checked={form.outsourced_commission} onChange={(v) => setForm({ ...form, outsourced_commission: v })} />
                <Toggle label="Include in Base Product PO" checked={form.include_base_product_in_po} onChange={(v) => setForm({ ...form, include_base_product_in_po: v })} />
                <Toggle label="Print Image on PDF" checked={form.print_image_on_pdf} onChange={(v) => setForm({ ...form, print_image_on_pdf: v })} />
              </div>
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-qm-gray border-b border-gray-200 pb-1 mb-3">Production Notes</h3>
              <Field label="Production Details">
                <textarea value={form.production_details ?? ''} onChange={(e) => setForm({ ...form, production_details: e.target.value || null })} rows={4} className={inputClass} placeholder="Internal notes visible on Sales Orders for the production team" />
              </Field>
            </div>
          </div>
        )}

        {/* ---- TAB 3 — PRICING ---- */}
        {activeTab === 'pricing' && (
          <div className="space-y-8">
            {/* Top pricing section */}
            <div className="space-y-5 max-w-3xl">
              {/* Pricing type selector */}
              <Field label="Pricing Type">
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                  {(['Formula', 'Basic', 'Grid'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, pricing_type: t })}
                      className={`px-5 py-2 text-sm font-semibold rounded-md transition-all ${
                        form.pricing_type === t ? 'bg-white text-qm-lime shadow-sm' : 'text-qm-gray hover:text-qm-black'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Field>

              {form.pricing_type === 'Formula' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Formula">
                      <select value={form.formula ?? ''} onChange={(e) => setForm({ ...form, formula: e.target.value || null })} className={inputClass}>
                        <option value="">— Select a formula —</option>
                        {pricingFormulas.map((pf) => (
                          <option key={pf.id} value={pf.name}>{pf.name} ({pf.uom})</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Pricing Method">
                      <div className="flex gap-4 pt-2">
                        {(['Standard', 'Cost Plus'] as const).map((m) => (
                          <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="radio" checked={form.pricing_method === m} onChange={() => setForm({ ...form, pricing_method: m })} className="accent-qm-lime" />
                            {m}
                          </label>
                        ))}
                      </div>
                    </Field>
                  </div>
                  <Toggle label="Show Feet/Inches on Quote" checked={form.show_feet_inches} onChange={(v) => setForm({ ...form, show_feet_inches: v })} />
                </>
              )}

              {form.pricing_type === 'Basic' && (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-qm-gray">
                  Basic pricing uses a flat price — no formula needed.
                </div>
              )}

              {form.pricing_type === 'Grid' && (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-qm-gray">
                  Grid pricing (quantity × size matrix) will be configurable after saving the product.
                </div>
              )}

              {/* Buying + units */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Buying Cost">
                  <input type="number" step="0.01" value={form.buying_cost ?? ''} onChange={(e) => setForm({ ...form, buying_cost: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                </Field>
                <Field label="Buying Units">
                  <select value={form.buying_units ?? ''} onChange={(e) => setForm({ ...form, buying_units: e.target.value || null })} className={inputClass}>
                    <option value="">—</option>
                    {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Conversion Factor">
                  <input type="number" step="0.01" value={form.conversion_factor ?? ''} onChange={(e) => setForm({ ...form, conversion_factor: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                </Field>
                <Field label="Selling Units">
                  <select value={form.units ?? ''} onChange={(e) => setForm({ ...form, units: e.target.value || null })} className={inputClass}>
                    <option value="">—</option>
                    {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
              </div>

              {/* Triangle */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-qm-gray border-b border-gray-200 pb-1 mb-3">Cost / Markup / Price</h3>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Cost ($)">
                    <input type="number" step="0.01" value={form.cost} onChange={(e) => setCost(parseFloat(e.target.value) || 0)} className={inputClass} />
                  </Field>
                  <Field label="Markup (×)">
                    <input type="number" step="0.01" value={form.markup} onChange={(e) => setMarkup(parseFloat(e.target.value) || 0)} className={inputClass} />
                  </Field>
                  <Field label="Price ($)">
                    <input type="number" step="0.01" value={form.price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} className={inputClass} />
                  </Field>
                </div>
                <div className="mt-3 rounded-lg bg-qm-lime-light px-4 py-2 text-sm">
                  <span className="text-qm-lime-dark font-semibold">Profit Margin:</span>{' '}
                  <span className="text-qm-black font-bold">{profitMargin ?? '—'}%</span>
                </div>
              </div>

              {/* Min prices */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Minimum Line Price">
                  <input type="number" step="0.01" value={form.min_line_price ?? ''} onChange={(e) => setForm({ ...form, min_line_price: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                </Field>
                <Field label="Minimum Unit Price">
                  <input type="number" step="0.01" value={form.min_unit_price ?? ''} onChange={(e) => setForm({ ...form, min_unit_price: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                </Field>
              </div>

              {/* Discounts */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Volume Discount">
                  <select value={form.volume_discount_id ?? ''} onChange={(e) => setForm({ ...form, volume_discount_id: e.target.value || null })} className={inputClass}>
                    <option value="">—</option>
                    {discounts.filter((d) => d.discount_type === 'Volume').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Range Discount">
                  <select value={form.range_discount_id ?? ''} onChange={(e) => setForm({ ...form, range_discount_id: e.target.value || null })} className={inputClass}>
                    <option value="">—</option>
                    {discounts.filter((d) => d.discount_type === 'Range').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            {/* ---- Section 2: Product Recipe ---- */}
            <div className="border-t border-gray-200 pt-6 space-y-6">
              <div>
                <h2 className="text-base font-bold text-qm-black">Product Recipe</h2>
                <p className="text-xs text-qm-gray mt-0.5">The materials, labor, and machine rates that build this product&apos;s cost.</p>
              </div>

              {/* Materials — full width */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-qm-gray">Materials {recipeMaterials.length > 0 && <span className="text-qm-gray/70">({recipeMaterials.length})</span>}</h3>
                  <button type="button" onClick={() => openSearchForRecipe('Material')} className="inline-flex items-center gap-1 rounded-md bg-qm-lime px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    Add Material
                  </button>
                </div>
                {recipeMaterials.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-xs text-qm-gray">
                    No materials yet.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="w-8 px-2"></th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Material</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Formula</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500 w-24">Multiplier</th>
                          <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">In Base</th>
                          <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Optional</th>
                          <th className="w-12 px-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {recipeMaterials.map((row, i) => (
                          <tr
                            key={i}
                            draggable
                            onDragStart={() => setMaterialDragIndex(i)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleMaterialDrop(i)}
                            className={materialDragIndex === i ? 'opacity-50' : ''}
                          >
                            <td className="px-2 text-center">
                              <span className="cursor-grab text-qm-gray" title="Drag to reorder">
                                <svg className="h-4 w-4 inline" fill="currentColor" viewBox="0 0 20 20"><path d="M7 2a1 1 0 000 2h1v12H7a1 1 0 100 2h6a1 1 0 100-2h-1V4h1a1 1 0 100-2H7z" /></svg>
                              </span>
                            </td>
                            <td className="px-3 py-2 text-sm font-medium text-qm-black">{row.display_name}</td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={row.system_formula ?? ''}
                                onChange={(e) => updateRecipeRow(setRecipeMaterials, i, { system_formula: e.target.value || null })}
                                placeholder="e.g. width * height"
                                className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                step="0.01"
                                value={row.multiplier ?? ''}
                                onChange={(e) => updateRecipeRow(setRecipeMaterials, i, { multiplier: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                placeholder="1"
                                className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={row.include_in_base_price} onChange={(e) => updateRecipeRow(setRecipeMaterials, i, { include_in_base_price: e.target.checked })} className="accent-qm-lime h-4 w-4" />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={row.is_optional} onChange={(e) => updateRecipeRow(setRecipeMaterials, i, { is_optional: e.target.checked })} className="accent-qm-lime h-4 w-4" />
                            </td>
                            <td className="px-2 text-center">
                              <button type="button" onClick={() => removeRecipeRow(setRecipeMaterials, i)} className="rounded p-1 text-red-500 hover:bg-red-50" title="Delete">
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Labor + Machine side-by-side — intentional pairing so estimators
                  can match labor and machine rates visually. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <RateColumn
                  title="Labor Rates"
                  count={recipeLabor.length}
                  rows={recipeLabor}
                  setter={setRecipeLabor}
                  onAdd={() => openSearchForRecipe('LaborRate')}
                  addLabel="Add Labor Rate"
                  updateRow={updateRecipeRow}
                  removeRow={removeRecipeRow}
                />
                <RateColumn
                  title="Machine Rates"
                  count={recipeMachine.length}
                  rows={recipeMachine}
                  setter={setRecipeMachine}
                  onAdd={() => openSearchForRecipe('MachineRate')}
                  addLabel="Add Machine Rate"
                  updateRow={updateRecipeRow}
                  removeRow={removeRecipeRow}
                />
              </div>
            </div>

            {/* ---- Section 3: Dropdown Menus ---- */}
            <div className="border-t border-gray-200 pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-qm-black">Dropdown Menus</h2>
                  <p className="text-xs text-qm-gray mt-0.5">Named option groups shown on quotes (e.g. &quot;Printer Options&quot;).</p>
                </div>
                <button
                  type="button"
                  onClick={addMenu}
                  className="inline-flex items-center gap-1 rounded-md bg-qm-lime px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add Menu
                </button>
              </div>
              {dropdownMenus.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-xs text-qm-gray">
                  No dropdown menus yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {dropdownMenus.map((menu, menuIdx) => (
                    <div key={menuIdx} className="rounded-lg border border-gray-200 bg-white">
                      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                        <button
                          type="button"
                          onClick={() => toggleMenuExpanded(menuIdx)}
                          className="text-qm-gray hover:text-qm-black"
                          title="Toggle"
                        >
                          <svg className={`h-4 w-4 transition-transform ${expandedMenus.has(menuIdx) ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                          </svg>
                        </button>
                        <input
                          type="text"
                          value={menu.menu_name}
                          onChange={(e) => updateMenu(menuIdx, { menu_name: e.target.value })}
                          placeholder="Menu name (e.g. Printer Options)"
                          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        />
                        <label className="flex items-center gap-1 text-xs text-qm-gray">
                          <input type="checkbox" checked={menu.is_optional} onChange={(e) => updateMenu(menuIdx, { is_optional: e.target.checked })} className="accent-qm-lime" />
                          Optional
                        </label>
                        <div className="inline-flex gap-1">
                          <button type="button" onClick={() => moveMenu(menuIdx, -1)} disabled={menuIdx === 0} className="rounded p-1 text-qm-gray hover:bg-gray-100 disabled:opacity-30">↑</button>
                          <button type="button" onClick={() => moveMenu(menuIdx, 1)} disabled={menuIdx === dropdownMenus.length - 1} className="rounded p-1 text-qm-gray hover:bg-gray-100 disabled:opacity-30">↓</button>
                        </div>
                        <button type="button" onClick={() => removeMenu(menuIdx)} className="rounded p-1 text-red-500 hover:bg-red-50">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      {expandedMenus.has(menuIdx) && (
                        <div className="p-4 space-y-2 bg-gray-50">
                          {menu.items.length === 0 ? (
                            <p className="text-xs text-qm-gray italic">No items in this menu yet.</p>
                          ) : (
                            <div className="space-y-1">
                              {menu.items.map((item, itemIdx) => (
                                <div key={itemIdx} className="flex items-center gap-2 rounded-md bg-white px-3 py-2 border border-gray-100">
                                  <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2 py-0.5 text-xs font-semibold text-qm-lime-dark shrink-0">
                                    {item.type_label}
                                  </span>
                                  <span className="flex-1 text-sm text-qm-black truncate">{item.display_name}</span>
                                  <button type="button" onClick={() => removeDropdownItem(menuIdx, itemIdx)} className="rounded p-1 text-red-500 hover:bg-red-50">
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => openSearchForDropdownItem(menuIdx)}
                            className="text-xs font-semibold text-qm-lime hover:underline"
                          >
                            + Add item to this menu
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ---- Section 4: Modifiers ---- */}
            <div className="border-t border-gray-200 pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-qm-black">Modifiers</h2>
                  <p className="text-xs text-qm-gray mt-0.5">Attach modifiers that apply to this product.</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setModifierPickerOpen(true); setModifierSearch('') }}
                  className="inline-flex items-center gap-1 rounded-md bg-qm-lime px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add Modifier
                </button>
              </div>
              {modifierRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-xs text-qm-gray">
                  No modifiers attached yet.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Display Name</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                        <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Required</th>
                        <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Sort</th>
                        <th className="w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {modifierRows.map((m, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-sm font-medium text-qm-black">{m.display_name}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center rounded-full bg-qm-fuchsia-light px-2 py-0.5 text-xs font-semibold text-qm-fuchsia">
                              {m.modifier_type}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" checked={m.is_required} onChange={(e) => updateModifierRow(i, { is_required: e.target.checked })} className="accent-qm-lime h-4 w-4" />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="inline-flex gap-1">
                              <button type="button" onClick={() => moveModifierRow(i, -1)} disabled={i === 0} className="rounded p-1 text-qm-gray hover:bg-gray-100 disabled:opacity-30">↑</button>
                              <button type="button" onClick={() => moveModifierRow(i, 1)} disabled={i === modifierRows.length - 1} className="rounded p-1 text-qm-gray hover:bg-gray-100 disabled:opacity-30">↓</button>
                            </div>
                          </td>
                          <td className="px-2 text-center">
                            <button type="button" onClick={() => removeModifierRow(i)} className="rounded p-1 text-red-500 hover:bg-red-50">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'custom-fields' && (
          <div className="space-y-4 max-w-4xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-qm-black">Custom Fields</h2>
                <p className="text-xs text-qm-gray mt-0.5">Per-product fields shown on the quote form. Drag to reorder.</p>
              </div>
              <button
                type="button"
                onClick={addCustomField}
                className="inline-flex items-center gap-1 rounded-md bg-qm-lime px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                Add Field
              </button>
            </div>
            {customFields.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-qm-gray">
                No custom fields yet. Click &quot;Add Field&quot; to define one.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Field Name</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500 w-40">Type</th>
                      <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Required</th>
                      <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Print on PDF</th>
                      <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500 w-20">Order</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {customFields.map((f, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={f.field_name}
                            onChange={(e) => updateCustomField(i, { field_name: e.target.value })}
                            placeholder="e.g. Installation address"
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={f.field_type}
                            onChange={(e) => updateCustomField(i, { field_type: e.target.value as ProductCustomFieldInput['field_type'] })}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                          >
                            <option value="text">Text</option>
                            <option value="textarea">Textarea</option>
                            <option value="radio">Radio</option>
                            <option value="color">Color</option>
                            <option value="dropdown">Dropdown</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={f.is_required} onChange={(e) => updateCustomField(i, { is_required: e.target.checked })} className="accent-qm-lime h-4 w-4" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={f.print_on_customer_pdf} onChange={(e) => updateCustomField(i, { print_on_customer_pdf: e.target.checked })} className="accent-qm-lime h-4 w-4" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="inline-flex gap-1">
                            <button type="button" onClick={() => moveCustomField(i, -1)} disabled={i === 0} className="rounded p-1 text-qm-gray hover:bg-gray-100 disabled:opacity-30">↑</button>
                            <button type="button" onClick={() => moveCustomField(i, 1)} disabled={i === customFields.length - 1} className="rounded p-1 text-qm-gray hover:bg-gray-100 disabled:opacity-30">↓</button>
                          </div>
                        </td>
                        <td className="px-2 text-center">
                          <button type="button" onClick={() => removeCustomField(i)} className="rounded p-1 text-red-500 hover:bg-red-50" title="Delete">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Search modal — shared by Recipe and Dropdown Items.
          Recipe mode locks the category; Dropdown mode allows switching. */}
      {searchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSearchModal(null)} />
          <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <h3 className="text-sm font-bold text-qm-black">
                {searchModal.kind === 'recipe'
                  ? `Add ${searchModal.itemType === 'Material' ? 'Material' : searchModal.itemType === 'LaborRate' ? 'Labor Rate' : 'Machine Rate'}`
                  : 'Add Dropdown Item'}
              </h3>
              <button onClick={() => setSearchModal(null)} className="text-qm-gray hover:text-qm-black">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {searchModal.kind === 'dropdown-item' && (
              <div className="border-b border-gray-200 flex">
                {(['Material', 'LaborRate', 'MachineRate'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSearchCategory(cat)}
                    className={`flex-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 -mb-px ${
                      searchCategory === cat ? 'border-qm-lime text-qm-lime' : 'border-transparent text-qm-gray hover:text-qm-black'
                    }`}
                  >
                    {cat === 'LaborRate' ? 'Labor Rates' : cat === 'MachineRate' ? 'Machine Rates' : 'Materials'}
                  </button>
                ))}
              </div>
            )}
            <div className="px-5 py-3 border-b border-gray-100">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name..."
                autoFocus
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {searchResults.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-qm-gray">No results</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {searchResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        if (searchModal.kind === 'recipe') {
                          addRecipeFromSearch(r)
                        } else {
                          addDropdownItemFromSearch(searchCategory, r)
                        }
                      }}
                      className="w-full text-left px-5 py-2.5 hover:bg-qm-surface transition-colors"
                    >
                      <div className="text-sm font-medium text-qm-black">{r.name}</div>
                      <div className="text-xs text-qm-gray">
                        ${Number(r.cost).toFixed(2)} cost · ${Number(r.price).toFixed(2)} price
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-gray-200 px-5 py-2.5 text-xs text-qm-gray">
              Showing up to 50 results
            </div>
          </div>
        </div>
      )}

      {/* Modifier picker modal */}
      {modifierPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModifierPickerOpen(false)} />
          <div className="relative w-full max-w-lg rounded-xl bg-white shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <h3 className="text-sm font-bold text-qm-black">Add Modifier</h3>
              <button onClick={() => setModifierPickerOpen(false)} className="text-qm-gray hover:text-qm-black">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-3 border-b border-gray-100">
              <input
                type="text"
                value={modifierSearch}
                onChange={(e) => setModifierSearch(e.target.value)}
                placeholder="Search modifiers..."
                autoFocus
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {modifierResults.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-qm-gray">No modifiers found</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {modifierResults.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => addModifierFromPicker(m)}
                      className="w-full text-left px-5 py-2.5 hover:bg-qm-surface transition-colors"
                    >
                      <div className="text-sm font-medium text-qm-black">{m.display_name}</div>
                      <div className="text-xs text-qm-gray">{m.modifier_type}{m.units ? ` · ${m.units}` : ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
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
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button type="button" onClick={() => onChange(!checked)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-qm-lime' : 'bg-gray-300'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

// Single column for Labor Rates / Machine Rates inside the Product Recipe section.
function RateColumn({
  title, count, rows, setter, onAdd, addLabel, updateRow, removeRow,
}: {
  title: string
  count: number
  rows: (DefaultItemInput & { display_name: string })[]
  setter: React.Dispatch<React.SetStateAction<(DefaultItemInput & { display_name: string })[]>>
  onAdd: () => void
  addLabel: string
  updateRow: (
    setter: React.Dispatch<React.SetStateAction<(DefaultItemInput & { display_name: string })[]>>,
    i: number,
    patch: Partial<DefaultItemInput>,
  ) => void
  removeRow: (
    setter: React.Dispatch<React.SetStateAction<(DefaultItemInput & { display_name: string })[]>>,
    i: number,
  ) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-qm-gray">
          {title} {count > 0 && <span className="text-qm-gray/70">({count})</span>}
        </h3>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-xs text-qm-gray">
          No {title.toLowerCase()} yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Formula</th>
                <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Per LI</th>
                <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">In Base</th>
                <th className="w-10 px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-sm font-medium text-qm-black">{row.display_name}</td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={row.system_formula ?? ''}
                      onChange={(e) => updateRow(setter, i, { system_formula: e.target.value || null })}
                      placeholder="Optional"
                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={row.charge_per_li_unit} onChange={(e) => updateRow(setter, i, { charge_per_li_unit: e.target.checked })} className="accent-qm-lime h-4 w-4" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={row.include_in_base_price} onChange={(e) => updateRow(setter, i, { include_in_base_price: e.target.checked })} className="accent-qm-lime h-4 w-4" />
                  </td>
                  <td className="px-2 text-center">
                    <button type="button" onClick={() => removeRow(setter, i)} className="rounded p-1 text-red-500 hover:bg-red-50" title="Delete">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        onClick={onAdd}
        className="w-full inline-flex items-center justify-center gap-1 rounded-md border border-dashed border-qm-lime bg-qm-lime-light/40 px-3 py-2 text-xs font-semibold text-qm-lime-dark hover:bg-qm-lime-light"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        {addLabel}
      </button>
    </div>
  )
}

'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type {
  Product, ProductCategory, WorkflowTemplate, Discount,
  Material, LaborRate, MachineRate, Modifier,
  ProductDefaultItem, ProductModifier,
} from '@/types/product-builder'
import {
  saveMigrationDraft, publishMigration,
  type MigrateBundle, type MigrateDefaultItem, type MigrateModifier,
  type MigrateDropdownMenu,
} from './actions'

// ---- Shopvox data shape (JSON-B on products.shopvox_data) ----
export type ShopvoxData = {
  basic?: {
    name?: string | null
    display_name?: string | null
    type?: string | null
    workflow?: string | null
    category?: string | null
    secondary_category?: string | null
  } | null
  pricing?: {
    pricing_type?: string | null
    formula?: string | null
    pricing_method?: string | null
    buying_units?: string | null
    range_discount?: string | null
    apply_discounts?: boolean | null
    apply_range_discount_for_qty?: boolean | null
  } | null
  modifiers?: { name: string; type: 'Numeric' | 'Boolean' | 'Range'; default?: string | number | boolean | null }[]
  dropdown_menus?: { name: string; kind: 'Material' | 'LaborRate' | 'MachineRate'; category?: string | null; optional?: boolean | null }[]
  default_items?: {
    idx?: number
    name: string
    kind: 'Material' | 'LaborRate' | 'MachineRate'
    formula: string
    multiplier: number
    per_li: boolean
    modifier: { kind: 'checkbox' | 'numeric' | 'formula'; expression: string } | null
    note?: string
  }[]
}

export type ExistingDropdownMenu = {
  menu_name: string
  is_optional: boolean
  items: {
    item_type: 'Material' | 'LaborRate' | 'MachineRate'
    material_id: string | null
    labor_rate_id: string | null
    machine_rate_id: string | null
    system_formula: string | null
    charge_per_li_unit: boolean
    is_optional: boolean
  }[]
}

type MaterialOption = Pick<Material, 'id' | 'name'>
type LaborRateOption = Pick<LaborRate, 'id' | 'name'>
type MachineRateOption = Pick<MachineRate, 'id' | 'name'>

type Props = {
  orgId: string
  orgName: string
  orgSlug: string
  product: Product
  shopvoxData: ShopvoxData | null
  migrationStatus: string
  categories: ProductCategory[]
  workflows: WorkflowTemplate[]
  discounts: Discount[]
  materials: MaterialOption[]
  laborRates: LaborRateOption[]
  machineRates: MachineRateOption[]
  modifiersList: Modifier[]
  existingDefaultItems: ProductDefaultItem[]
  existingModifiers: ProductModifier[]
  existingDropdownMenus: ExistingDropdownMenu[]
}

// ---- Enriched rows carry an id + display for React keys and UI ----
type DefaultItemRow = MigrateDefaultItem & {
  id: string
  display_name: string
  matched: boolean // true when the row is linked to a real DB record
}

type ModifierRow = MigrateModifier & {
  id: string
  display_name: string
  modifier_type: string
}

type DropdownItemRow = {
  item_type: 'Material' | 'LaborRate' | 'MachineRate'
  material_id: string | null
  labor_rate_id: string | null
  machine_rate_id: string | null
  system_formula: string | null
  charge_per_li_unit: boolean
  is_optional: boolean
  id: string
  display_name: string
  matched: boolean
}

type DropdownMenuRow = {
  id: string
  menu_name: string
  is_optional: boolean
  items: DropdownItemRow[]
}

const PRICING_FORMULA_OPTIONS = ['Area', 'Perimeter', 'Width', 'Height', 'Unit']
const UNIT_OPTIONS = ['Each', 'Sqft', 'Roll', 'Sheet', 'Unit', 'Feet', 'Inch', 'Yard', 'Hr']

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function lcMap<T extends { id: string; name: string }>(rows: T[]) {
  const map = new Map<string, T>()
  for (const r of rows) map.set(r.name.toLowerCase().trim(), r)
  return map
}

export default function MigrateClient({
  orgId, orgName, orgSlug, product, shopvoxData, migrationStatus,
  categories, workflows, discounts,
  materials, laborRates, machineRates, modifiersList,
  existingDefaultItems, existingModifiers, existingDropdownMenus,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Lookup maps (case-insensitive by name)
  const materialByName = useMemo(() => lcMap(materials), [materials])
  const laborByName = useMemo(() => lcMap(laborRates), [laborRates])
  const machineByName = useMemo(() => lcMap(machineRates), [machineRates])
  const discountByName = useMemo(() => {
    const m = new Map<string, Discount>()
    for (const d of discounts) m.set(d.name.toLowerCase().trim(), d)
    return m
  }, [discounts])
  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials])
  const laborById = useMemo(() => new Map(laborRates.map((l) => [l.id, l])), [laborRates])
  const machineById = useMemo(() => new Map(machineRates.map((m) => [m.id, m])), [machineRates])
  const modifierById = useMemo(() => new Map(modifiersList.map((m) => [m.id, m])), [modifiersList])
  const modifierByName = useMemo(() => {
    // keyed by system_lookup_name OR display_name lowercased
    const m = new Map<string, Modifier>()
    for (const mod of modifiersList) {
      if (mod.system_lookup_name) m.set(mod.system_lookup_name.toLowerCase().trim(), mod)
      m.set(mod.display_name.toLowerCase().trim(), mod)
      m.set(mod.name.toLowerCase().trim(), mod)
    }
    return m
  }, [modifiersList])

  function lookupItemName(row: MigrateDefaultItem): string {
    if (row.item_type === 'Material' && row.material_id) return materialById.get(row.material_id)?.name ?? 'Unknown material'
    if (row.item_type === 'LaborRate' && row.labor_rate_id) return laborById.get(row.labor_rate_id)?.name ?? 'Unknown labor rate'
    if (row.item_type === 'MachineRate' && row.machine_rate_id) return machineById.get(row.machine_rate_id)?.name ?? 'Unknown machine rate'
    return row.custom_item_name ?? 'Custom'
  }
  function lookupDropdownItemName(row: DropdownItemRow): string {
    if (row.item_type === 'Material' && row.material_id) return materialById.get(row.material_id)?.name ?? '—'
    if (row.item_type === 'LaborRate' && row.labor_rate_id) return laborById.get(row.labor_rate_id)?.name ?? '—'
    if (row.item_type === 'MachineRate' && row.machine_rate_id) return machineById.get(row.machine_rate_id)?.name ?? '—'
    return '—'
  }

  // ---- Initial state hydrated from existing PrintOS rows ----
  type BasicState = {
    name: string
    description: string
    product_type: string
    category_id: string | null
    secondary_category: string
    workflow_template_id: string | null
  }
  const [basic, setBasic] = useState<BasicState>({
    name: product.name,
    description: product.description ?? '',
    product_type: product.product_type ?? '',
    category_id: product.category_id,
    secondary_category: product.secondary_category ?? '',
    workflow_template_id: product.workflow_template_id,
  })

  type PricingState = {
    pricing_type: 'Formula' | 'Basic' | 'Grid' | 'Cost Plus' | null
    pricing_method: string | null
    formula: string | null
    buying_units: string | null
    range_discount_id: string | null
  }
  const [pricing, setPricing] = useState<PricingState>({
    pricing_type: (product.pricing_type as 'Formula' | 'Basic' | 'Grid' | 'Cost Plus' | null) ?? 'Formula',
    pricing_method: product.pricing_method ?? 'Standard',
    formula: product.formula ?? 'Area',
    buying_units: product.buying_units ?? 'Each',
    range_discount_id: product.range_discount_id,
  })

  const [defaultItems, setDefaultItems] = useState<DefaultItemRow[]>(() =>
    existingDefaultItems.map((r) => {
      const base: MigrateDefaultItem = {
        item_type: (r.item_type as MigrateDefaultItem['item_type']) ?? 'Material',
        material_id: r.material_id,
        labor_rate_id: r.labor_rate_id,
        machine_rate_id: r.machine_rate_id,
        custom_item_name: r.custom_item_name,
        system_formula: r.system_formula,
        multiplier: r.multiplier ?? 1,
        charge_per_li_unit: r.charge_per_li_unit ?? false,
        include_in_base_price: r.include_in_base_price ?? true,
        menu_name: r.menu_name, // reused to store modifier expression
        is_optional: r.is_optional ?? false,
      }
      const display = lookupItemName(base)
      const matched = !!(base.material_id || base.labor_rate_id || base.machine_rate_id)
      return { ...base, id: uid(), display_name: display, matched }
    })
  )

  const [modifierRows, setModifierRows] = useState<ModifierRow[]>(() =>
    existingModifiers
      .filter((m) => m.modifier_id)
      .map((m) => {
        const mod = modifierById.get(m.modifier_id!)
        return {
          id: uid(),
          modifier_id: m.modifier_id!,
          is_required: m.is_required ?? false,
          default_value: m.default_value,
          display_name: mod?.display_name ?? 'Unknown',
          modifier_type: mod?.modifier_type ?? '',
        }
      })
  )

  const [dropdownMenus, setDropdownMenus] = useState<DropdownMenuRow[]>(() =>
    existingDropdownMenus.map((menu) => ({
      id: uid(),
      menu_name: menu.menu_name,
      is_optional: menu.is_optional,
      items: menu.items.map((i) => {
        const row: DropdownItemRow = {
          ...i,
          id: uid(),
          display_name: '',
          matched: !!(i.material_id || i.labor_rate_id || i.machine_rate_id),
        }
        row.display_name = lookupDropdownItemName(row)
        return row
      }),
    }))
  )

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  // ---- Copy handlers: ShopVOX → PrintOS ----

  function copyBasic() {
    const b = shopvoxData?.basic
    if (!b) return
    setBasic((prev) => ({
      ...prev,
      name: b.name ?? prev.name,
      description: b.display_name ?? prev.description,
      product_type: b.type ?? prev.product_type,
      secondary_category: b.secondary_category ?? prev.secondary_category,
      category_id:
        categories.find((c) => c.name.toLowerCase() === (b.category ?? '').toLowerCase())?.id ?? prev.category_id,
      workflow_template_id:
        workflows.find((w) => w.name.toLowerCase() === (b.workflow ?? '').toLowerCase())?.id ??
        prev.workflow_template_id,
    }))
    showToast('Copied basic info')
  }

  function copyPricing() {
    const p = shopvoxData?.pricing
    if (!p) return
    setPricing((prev) => ({
      ...prev,
      pricing_type: (p.pricing_type as 'Formula' | 'Basic' | 'Grid' | 'Cost Plus') ?? prev.pricing_type,
      pricing_method: p.pricing_method ?? prev.pricing_method,
      formula: p.formula ?? prev.formula,
      buying_units: p.buying_units ?? prev.buying_units,
      range_discount_id:
        discountByName.get((p.range_discount ?? '').toLowerCase())?.id ?? prev.range_discount_id,
    }))
    showToast('Copied pricing')
  }

  function copyShopvoxModifier(m: NonNullable<ShopvoxData['modifiers']>[number]) {
    const match = modifierByName.get(m.name.toLowerCase().trim())
    if (!match) {
      showToast(`No match in DB for modifier "${m.name}"`)
      return
    }
    if (modifierRows.some((r) => r.modifier_id === match.id)) {
      showToast(`"${match.display_name}" is already added`)
      return
    }
    setModifierRows((rows) => [
      ...rows,
      {
        id: uid(),
        modifier_id: match.id,
        is_required: false,
        default_value: null,
        display_name: match.display_name,
        modifier_type: match.modifier_type,
      },
    ])
  }

  function copyAllShopvoxModifiers() {
    const list = shopvoxData?.modifiers ?? []
    let added = 0
    let missing = 0
    setModifierRows((rows) => {
      const next = [...rows]
      const existingIds = new Set(rows.map((r) => r.modifier_id))
      for (const m of list) {
        const match = modifierByName.get(m.name.toLowerCase().trim())
        if (!match) { missing++; continue }
        if (existingIds.has(match.id)) continue
        existingIds.add(match.id)
        next.push({
          id: uid(),
          modifier_id: match.id,
          is_required: false,
          default_value: null,
          display_name: match.display_name,
          modifier_type: match.modifier_type,
        })
        added++
      }
      return next
    })
    showToast(`Added ${added} modifiers${missing ? `, ${missing} had no match` : ''}`)
  }

  function copyShopvoxDropdown(m: NonNullable<ShopvoxData['dropdown_menus']>[number]) {
    setDropdownMenus((menus) => [
      ...menus,
      { id: uid(), menu_name: m.name, is_optional: m.optional ?? false, items: [] },
    ])
    showToast(`Added menu "${m.name}"`)
  }

  function copyAllShopvoxDropdowns() {
    const list = shopvoxData?.dropdown_menus ?? []
    setDropdownMenus((menus) => [
      ...menus,
      ...list.map((m) => ({ id: uid(), menu_name: m.name, is_optional: m.optional ?? false, items: [] as DropdownItemRow[] })),
    ])
    showToast(`Added ${list.length} dropdown menus`)
  }

  function shopvoxItemToRow(it: NonNullable<ShopvoxData['default_items']>[number]): DefaultItemRow {
    const lookup =
      it.kind === 'Material' ? materialByName.get(it.name.toLowerCase().trim())
      : it.kind === 'LaborRate' ? laborByName.get(it.name.toLowerCase().trim())
      : machineByName.get(it.name.toLowerCase().trim())
    const base: MigrateDefaultItem = {
      item_type: it.kind,
      material_id: it.kind === 'Material' ? (lookup?.id ?? null) : null,
      labor_rate_id: it.kind === 'LaborRate' ? (lookup?.id ?? null) : null,
      machine_rate_id: it.kind === 'MachineRate' ? (lookup?.id ?? null) : null,
      custom_item_name: lookup ? null : it.name,
      system_formula: it.formula,
      multiplier: it.multiplier,
      charge_per_li_unit: it.per_li,
      include_in_base_price: true,
      menu_name: it.modifier?.expression ?? null,
      is_optional: false,
    }
    return {
      ...base,
      id: uid(),
      display_name: lookup?.name ?? it.name,
      matched: !!lookup,
    }
  }

  function copyShopvoxDefaultItem(it: NonNullable<ShopvoxData['default_items']>[number]) {
    setDefaultItems((rows) => [...rows, shopvoxItemToRow(it)])
  }

  function copyAllShopvoxDefaultItems() {
    const list = shopvoxData?.default_items ?? []
    setDefaultItems((rows) => [...rows, ...list.map(shopvoxItemToRow)])
    const missing = list.filter((it) => {
      const m = it.kind === 'Material' ? materialByName.get(it.name.toLowerCase())
        : it.kind === 'LaborRate' ? laborByName.get(it.name.toLowerCase())
        : machineByName.get(it.name.toLowerCase())
      return !m
    }).length
    showToast(`Added ${list.length} items${missing ? `, ${missing} unmatched (custom)` : ''}`)
  }

  // ---- Default item row actions ----

  function updateDefaultItem(id: string, patch: Partial<MigrateDefaultItem>) {
    setDefaultItems((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function deleteDefaultItem(id: string) {
    setDefaultItems((rows) => rows.filter((r) => r.id !== id))
  }

  function addBlankDefaultItem() {
    setDefaultItems((rows) => [
      ...rows,
      {
        id: uid(),
        item_type: 'LaborRate',
        material_id: null,
        labor_rate_id: null,
        machine_rate_id: null,
        custom_item_name: 'New item',
        system_formula: 'Unit',
        multiplier: 1,
        charge_per_li_unit: false,
        include_in_base_price: true,
        menu_name: null,
        is_optional: false,
        display_name: 'New item',
        matched: false,
      },
    ])
  }

  function updateModifier(id: string, patch: Partial<MigrateModifier>) {
    setModifierRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function deleteModifier(id: string) {
    setModifierRows((rows) => rows.filter((r) => r.id !== id))
  }

  function addBlankMenu() {
    setDropdownMenus((menus) => [...menus, { id: uid(), menu_name: 'New menu', is_optional: false, items: [] }])
  }
  function updateMenu(id: string, patch: Partial<Pick<DropdownMenuRow, 'menu_name' | 'is_optional'>>) {
    setDropdownMenus((menus) => menus.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }
  function deleteMenu(id: string) {
    setDropdownMenus((menus) => menus.filter((m) => m.id !== id))
  }

  // ---- DnD ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setDefaultItems((rows) => {
      const oldIdx = rows.findIndex((r) => r.id === active.id)
      const newIdx = rows.findIndex((r) => r.id === over.id)
      if (oldIdx < 0 || newIdx < 0) return rows
      return arrayMove(rows, oldIdx, newIdx)
    })
  }

  // ---- Build bundle for save/publish ----
  function buildBundle(): MigrateBundle {
    return {
      basic: {
        name: basic.name,
        description: basic.description || null,
        product_type: basic.product_type || null,
        category_id: basic.category_id,
        secondary_category: basic.secondary_category || null,
        workflow_template_id: basic.workflow_template_id,
      },
      pricing: {
        pricing_type: pricing.pricing_type,
        pricing_method: pricing.pricing_method,
        formula: pricing.formula,
        buying_units: pricing.buying_units,
        range_discount_id: pricing.range_discount_id,
      },
      defaultItems: defaultItems.map((r) => ({
        item_type: r.item_type,
        material_id: r.material_id,
        labor_rate_id: r.labor_rate_id,
        machine_rate_id: r.machine_rate_id,
        custom_item_name: r.custom_item_name,
        system_formula: r.system_formula,
        multiplier: r.multiplier,
        charge_per_li_unit: r.charge_per_li_unit,
        include_in_base_price: r.include_in_base_price,
        menu_name: r.menu_name,
        is_optional: r.is_optional,
      })),
      modifiers: modifierRows.map((r) => ({
        modifier_id: r.modifier_id,
        is_required: r.is_required,
        default_value: r.default_value,
      })),
      dropdownMenus: dropdownMenus.map<MigrateDropdownMenu>((m) => ({
        menu_name: m.menu_name,
        is_optional: m.is_optional,
        items: m.items.map((i) => ({
          item_type: i.item_type,
          material_id: i.material_id,
          labor_rate_id: i.labor_rate_id,
          machine_rate_id: i.machine_rate_id,
          system_formula: i.system_formula,
          charge_per_li_unit: i.charge_per_li_unit,
          is_optional: i.is_optional,
        })),
      })),
    }
  }

  function handleSaveDraft() {
    setFormError(null)
    startTransition(async () => {
      const result = await saveMigrationDraft(product.id, orgId, orgSlug, buildBundle())
      if (result.error) setFormError(result.error)
      else { showToast('Draft saved'); router.refresh() }
    })
  }

  function handlePublish() {
    setFormError(null)
    startTransition(async () => {
      const result = await publishMigration(product.id, orgId, orgSlug, buildBundle())
      if (result.error) setFormError(result.error)
      else { showToast('Published to PrintOS'); router.refresh() }
    })
  }

  // ---- Render ----

  const statusBadge = migrationStatus === 'printos_ready'
    ? { label: 'PrintOS Ready', cls: 'bg-green-100 text-green-700 border-green-200' }
    : migrationStatus === 'in_progress'
      ? { label: 'In Progress', cls: 'bg-amber-100 text-amber-800 border-amber-200' }
      : { label: 'ShopVOX Reference', cls: 'bg-gray-100 text-gray-700 border-gray-200' }

  const hasShopvox = !!shopvoxData

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-green-800">{toast}</span>
        </div>
      )}

      {/* Top Bar */}
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Link href={`/dashboard/${orgSlug}`} className="hover:text-gray-700">{orgName}</Link>
              <span>/</span>
              <Link href={`/dashboard/${orgSlug}/products`} className="hover:text-gray-700">Products</Link>
              <span>/</span>
              <span className="text-gray-700 truncate max-w-[220px]">{product.name}</span>
              <span>/</span>
              <span className="text-gray-800 font-semibold">Migrate</span>
            </div>
            <h1 className="mt-0.5 text-xl font-extrabold text-qm-black truncate">{product.name}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
            {formError && (
              <span className="text-xs text-red-600">{formError}</span>
            )}
            <button
              onClick={handleSaveDraft}
              disabled={isPending}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {isPending ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              onClick={handlePublish}
              disabled={isPending}
              className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {isPending ? 'Publishing...' : 'Publish to PrintOS'}
            </button>
          </div>
        </div>
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        {/* ---- LEFT: ShopVOX Reference ---- */}
        <div className="space-y-4">
          <SectionHeaderLeft />
          {!hasShopvox && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
              No ShopVOX reference data saved for this product.
            </div>
          )}
          {hasShopvox && (
            <>
              {/* Basic */}
              <LeftSection title="Basic Info" onCopyAll={copyBasic} canCopy>
                <KV k="Name" v={shopvoxData!.basic?.name} />
                <KV k="Display Name" v={shopvoxData!.basic?.display_name} />
                <KV k="Type" v={shopvoxData!.basic?.type} />
                <KV k="Workflow" v={shopvoxData!.basic?.workflow} />
                <KV k="Category" v={shopvoxData!.basic?.category} />
                <KV k="Secondary Category" v={shopvoxData!.basic?.secondary_category} />
              </LeftSection>

              {/* Pricing */}
              <LeftSection title="Pricing" onCopyAll={copyPricing} canCopy>
                <KV k="Pricing Type" v={shopvoxData!.pricing?.pricing_type} />
                <KV k="Formula" v={shopvoxData!.pricing?.formula} />
                <KV k="Method" v={shopvoxData!.pricing?.pricing_method} />
                <KV k="Buying Units" v={shopvoxData!.pricing?.buying_units} />
                <KV k="Range Discount" v={shopvoxData!.pricing?.range_discount} />
                <KV k="Apply Discounts" v={shopvoxData!.pricing?.apply_discounts ? 'Yes' : 'No'} />
              </LeftSection>

              {/* Modifiers */}
              <LeftSection
                title={`Modifiers (${shopvoxData!.modifiers?.length ?? 0})`}
                onCopyAll={copyAllShopvoxModifiers}
                canCopy={!!shopvoxData!.modifiers?.length}
              >
                {(shopvoxData!.modifiers ?? []).map((m, i) => (
                  <LeftRow key={i} onCopy={() => copyShopvoxModifier(m)}>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        m.type === 'Boolean' ? 'bg-blue-100 text-blue-700' :
                        m.type === 'Numeric' ? 'bg-indigo-100 text-indigo-700' :
                        'bg-purple-100 text-purple-700'
                      }`}>{m.type}</span>
                      <span className="text-sm font-medium text-gray-800 truncate">{m.name}</span>
                      <span className="text-xs text-gray-400 ml-auto">
                        {typeof m.default === 'boolean' ? String(m.default) : m.default ?? ''}
                      </span>
                    </div>
                  </LeftRow>
                ))}
              </LeftSection>

              {/* Dropdown Menus */}
              <LeftSection
                title={`Dropdown Menus (${shopvoxData!.dropdown_menus?.length ?? 0})`}
                onCopyAll={copyAllShopvoxDropdowns}
                canCopy={!!shopvoxData!.dropdown_menus?.length}
              >
                {(shopvoxData!.dropdown_menus ?? []).map((m, i) => (
                  <LeftRow key={i} onCopy={() => copyShopvoxDropdown(m)}>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-700">{m.kind}</span>
                      <span className="text-sm font-medium text-gray-800 truncate">{m.name}</span>
                      {m.optional && <span className="text-[10px] text-gray-400 ml-auto">optional</span>}
                      {m.category && <span className="text-[10px] text-gray-400 ml-auto">{m.category}</span>}
                    </div>
                  </LeftRow>
                ))}
              </LeftSection>

              {/* Default Items */}
              <LeftSection
                title={`Default Items (${shopvoxData!.default_items?.length ?? 0})`}
                onCopyAll={copyAllShopvoxDefaultItems}
                canCopy={!!shopvoxData!.default_items?.length}
              >
                {(shopvoxData!.default_items ?? []).map((it, i) => (
                  <LeftRow key={i} onCopy={() => copyShopvoxDefaultItem(it)}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-gray-400 w-6 shrink-0">#{it.idx ?? i + 1}</span>
                        <TypeBadge kind={it.kind} />
                        <span className="text-sm font-medium text-gray-800 truncate">{it.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 pl-8">
                        <span><span className="text-gray-400">Formula:</span> {it.formula}</span>
                        <span><span className="text-gray-400">×</span> {it.multiplier}</span>
                        {it.per_li && <span className="text-amber-600">Per LI</span>}
                        {it.modifier && (
                          <span className="truncate" title={it.modifier.expression}>
                            <span className="text-gray-400">Mod:</span> {it.modifier.expression}
                          </span>
                        )}
                      </div>
                      {it.note && (
                        <div className="text-[11px] italic text-gray-400 pl-8">{it.note}</div>
                      )}
                    </div>
                  </LeftRow>
                ))}
              </LeftSection>
            </>
          )}
        </div>

        {/* ---- RIGHT: PrintOS Builder ---- */}
        <div className="space-y-4">
          <SectionHeaderRight />

          {/* Basic */}
          <RightSection title="Basic Info">
            <FieldRow label="Name">
              <input className={inputCls} value={basic.name} onChange={(e) => setBasic({ ...basic, name: e.target.value })} />
            </FieldRow>
            <FieldRow label="Description">
              <input className={inputCls} value={basic.description} onChange={(e) => setBasic({ ...basic, description: e.target.value })} />
            </FieldRow>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Type">
                <input className={inputCls} value={basic.product_type} onChange={(e) => setBasic({ ...basic, product_type: e.target.value })} />
              </FieldRow>
              <FieldRow label="Workflow">
                <select className={inputCls} value={basic.workflow_template_id ?? ''} onChange={(e) => setBasic({ ...basic, workflow_template_id: e.target.value || null })}>
                  <option value="">— None —</option>
                  {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </FieldRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Category">
                <select className={inputCls} value={basic.category_id ?? ''} onChange={(e) => setBasic({ ...basic, category_id: e.target.value || null })}>
                  <option value="">— None —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Secondary Category">
                <input className={inputCls} value={basic.secondary_category} onChange={(e) => setBasic({ ...basic, secondary_category: e.target.value })} />
              </FieldRow>
            </div>
          </RightSection>

          {/* Pricing */}
          <RightSection title="Pricing">
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Pricing Type">
                <select
                  className={inputCls}
                  value={pricing.pricing_type ?? ''}
                  onChange={(e) => setPricing({ ...pricing, pricing_type: (e.target.value || null) as typeof pricing.pricing_type })}
                >
                  <option value="Formula">Formula</option>
                  <option value="Basic">Basic</option>
                  <option value="Grid">Grid</option>
                  <option value="Cost Plus">Cost Plus</option>
                </select>
              </FieldRow>
              <FieldRow label="Method">
                <select className={inputCls} value={pricing.pricing_method ?? ''} onChange={(e) => setPricing({ ...pricing, pricing_method: e.target.value || null })}>
                  <option value="Standard">Standard</option>
                  <option value="Cost Plus">Cost Plus</option>
                </select>
              </FieldRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Formula">
                <select className={inputCls} value={pricing.formula ?? ''} onChange={(e) => setPricing({ ...pricing, formula: e.target.value || null })}>
                  {PRICING_FORMULA_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Buying Units">
                <select className={inputCls} value={pricing.buying_units ?? ''} onChange={(e) => setPricing({ ...pricing, buying_units: e.target.value || null })}>
                  <option value="">—</option>
                  {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </FieldRow>
            </div>
            <FieldRow label="Range Discount">
              <select className={inputCls} value={pricing.range_discount_id ?? ''} onChange={(e) => setPricing({ ...pricing, range_discount_id: e.target.value || null })}>
                <option value="">— None —</option>
                {discounts.filter((d) => d.discount_type === 'Range').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </FieldRow>
          </RightSection>

          {/* Modifiers */}
          <RightSection title={`Modifiers (${modifierRows.length})`}>
            {modifierRows.length === 0 ? (
              <EmptyState text="No modifiers yet. Use ← to copy from ShopVOX." />
            ) : (
              <div className="space-y-1">
                {modifierRows.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-md border border-gray-100 bg-white px-2 py-1.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      m.modifier_type === 'Boolean' ? 'bg-blue-100 text-blue-700' :
                      m.modifier_type === 'Numeric' ? 'bg-indigo-100 text-indigo-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>{m.modifier_type}</span>
                    <span className="text-sm font-medium text-gray-800 truncate flex-1">{m.display_name}</span>
                    <label className="flex items-center gap-1 text-[11px] text-gray-500">
                      <input type="checkbox" checked={m.is_required} onChange={(e) => updateModifier(m.id, { is_required: e.target.checked })} className="accent-qm-lime" />
                      required
                    </label>
                    <button onClick={() => deleteModifier(m.id)} className="rounded p-1 text-red-500 hover:bg-red-50" title="Remove">
                      <XIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </RightSection>

          {/* Dropdown Menus */}
          <RightSection title={`Dropdown Menus (${dropdownMenus.length})`} action={<AddBtn onClick={addBlankMenu}>Add Menu</AddBtn>}>
            {dropdownMenus.length === 0 ? (
              <EmptyState text="No dropdown menus yet." />
            ) : (
              <div className="space-y-2">
                {dropdownMenus.map((m) => (
                  <div key={m.id} className="rounded-md border border-gray-200 bg-white p-2">
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 rounded border border-gray-200 px-2 py-1 text-sm font-medium focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        value={m.menu_name}
                        onChange={(e) => updateMenu(m.id, { menu_name: e.target.value })}
                      />
                      <label className="flex items-center gap-1 text-[11px] text-gray-500">
                        <input type="checkbox" checked={m.is_optional} onChange={(e) => updateMenu(m.id, { is_optional: e.target.checked })} className="accent-qm-lime" />
                        optional
                      </label>
                      <button onClick={() => deleteMenu(m.id)} className="rounded p-1 text-red-500 hover:bg-red-50"><XIcon /></button>
                    </div>
                    {m.items.length > 0 && (
                      <div className="mt-1 pl-2 text-[11px] text-gray-500">{m.items.length} items</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </RightSection>

          {/* Default Items — Drag to reorder */}
          <RightSection title={`Default Items (${defaultItems.length})`} action={<AddBtn onClick={addBlankDefaultItem}>Add Item</AddBtn>}>
            {defaultItems.length === 0 ? (
              <EmptyState text="No items yet. Use ← to copy from ShopVOX." />
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={defaultItems.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {defaultItems.map((row) => (
                      <SortableDefaultItem
                        key={row.id}
                        row={row}
                        onUpdate={updateDefaultItem}
                        onDelete={deleteDefaultItem}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </RightSection>
        </div>
      </div>
    </div>
  )
}

// ---- Left column components ----

function SectionHeaderLeft() {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 border border-gray-200">
      <LockIcon />
      <h2 className="text-sm font-bold uppercase tracking-wider text-gray-600">ShopVOX Reference</h2>
      <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wider">Read-only</span>
    </div>
  )
}

function SectionHeaderRight() {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-qm-lime-light border border-qm-lime px-4 py-2.5">
      <EditIcon />
      <h2 className="text-sm font-bold uppercase tracking-wider text-qm-lime-dark">PrintOS Builder</h2>
      <span className="ml-auto text-[10px] text-qm-lime-dark/70 uppercase tracking-wider">Editable</span>
    </div>
  )
}

function LeftSection({
  title, children, onCopyAll, canCopy,
}: {
  title: string
  children: React.ReactNode
  onCopyAll: () => void
  canCopy: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-[#f8f8f8]">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h3>
        {canCopy && (
          <button
            onClick={onCopyAll}
            className="inline-flex items-center gap-1 rounded-md bg-white border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-qm-lime-light hover:border-qm-lime hover:text-qm-lime-dark"
          >
            Copy All <ArrowRightIcon />
          </button>
        )}
      </div>
      <div className="p-2 space-y-1">{children}</div>
    </div>
  )
}

function LeftRow({ onCopy, children }: { onCopy: () => void; children: React.ReactNode }) {
  return (
    <div className="group flex items-start gap-2 rounded-md border border-transparent bg-white px-2 py-1.5 hover:border-qm-lime hover:shadow-sm transition-all">
      <div className="flex-1 min-w-0">{children}</div>
      <button
        onClick={onCopy}
        className="shrink-0 rounded p-1 text-gray-400 hover:bg-qm-lime hover:text-white transition-colors"
        title="Copy to PrintOS"
      >
        <ArrowRightIcon />
      </button>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 w-32 shrink-0">{k}</span>
      <span className="text-sm text-gray-800 truncate">{v ?? '—'}</span>
    </div>
  )
}

// ---- Right column components ----

function RightSection({
  title, action, children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h3>
        {action}
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

function AddBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md bg-qm-lime px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-110"
    >
      <PlusIcon />{children}
    </button>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-gray-200 py-5 text-center text-xs text-gray-400">{text}</div>
}

function SortableDefaultItem({
  row, onUpdate, onDelete,
}: {
  row: DefaultItemRow
  onUpdate: (id: string, patch: Partial<MigrateDefaultItem>) => void
  onDelete: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 rounded-md border border-gray-100 bg-white px-2 py-1.5 hover:border-gray-200"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-gray-300 hover:text-gray-500 p-0.5"
        title="Drag to reorder"
        type="button"
      >
        <GripIcon />
      </button>
      <TypeBadge kind={row.item_type} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-800 truncate">{row.display_name}</span>
          {!row.matched && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700" title="No DB match — saved as custom item">
              unmatched
            </span>
          )}
        </div>
      </div>
      <select
        className="w-20 rounded border border-gray-200 px-1 py-0.5 text-xs"
        value={row.system_formula ?? ''}
        onChange={(e) => onUpdate(row.id, { system_formula: e.target.value || null })}
      >
        <option value="">—</option>
        {PRICING_FORMULA_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <input
        className="w-14 rounded border border-gray-200 px-1 py-0.5 text-xs tabular-nums"
        type="number"
        step="0.01"
        value={row.multiplier ?? ''}
        onChange={(e) => onUpdate(row.id, { multiplier: e.target.value === '' ? null : parseFloat(e.target.value) })}
        title="Multiplier"
      />
      <label className="flex items-center gap-1 text-[10px] text-gray-500" title="Charges per line-item quantity">
        <input
          type="checkbox"
          checked={row.charge_per_li_unit}
          onChange={(e) => onUpdate(row.id, { charge_per_li_unit: e.target.checked })}
          className="accent-qm-lime h-3.5 w-3.5"
        />
        Qty
      </label>
      <input
        className="w-36 rounded border border-gray-200 px-1 py-0.5 text-xs font-mono"
        type="text"
        placeholder="Modifier / expr"
        value={row.menu_name ?? ''}
        onChange={(e) => onUpdate(row.id, { menu_name: e.target.value || null })}
        title="Modifier name or formula expression"
      />
      <button
        onClick={() => onDelete(row.id)}
        className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
        title="Delete"
      >
        <XIcon />
      </button>
    </div>
  )
}

// ---- Icons & helpers ----

const inputCls = 'block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function TypeBadge({ kind }: { kind: 'Material' | 'LaborRate' | 'MachineRate' | 'CustomItem' }) {
  const s =
    kind === 'Material' ? 'bg-emerald-100 text-emerald-700' :
    kind === 'LaborRate' ? 'bg-sky-100 text-sky-700' :
    kind === 'MachineRate' ? 'bg-violet-100 text-violet-700' :
    'bg-gray-100 text-gray-600'
  const label = kind === 'LaborRate' ? 'Labor' : kind === 'MachineRate' ? 'Machine' : kind === 'CustomItem' ? 'Custom' : 'Material'
  return <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${s}`}>{label}</span>
}

function ArrowRightIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg className="h-4 w-4 text-qm-lime-dark" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487 18.549 2.8a2.121 2.121 0 1 1 3 3L19.862 7.487m-3-3L6.75 14.6V18h3.4l10.112-10.113m-3-3L12 8.25" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.4} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function GripIcon() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
      <path d="M7 4a1 1 0 110 2 1 1 0 010-2zM7 9a1 1 0 110 2 1 1 0 010-2zM7 14a1 1 0 110 2 1 1 0 010-2zM13 4a1 1 0 110 2 1 1 0 010-2zM13 9a1 1 0 110 2 1 1 0 010-2zM13 14a1 1 0 110 2 1 1 0 010-2z" />
    </svg>
  )
}

'use client'

import React, { useState, useMemo, useTransition } from 'react'
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
  Material, Modifier, MaterialCategory,
  ProductDefaultItem, ProductModifier,
} from '@/types/product-builder'
import {
  saveMigrationDraft, publishMigration,
  createMaterialCategory, createLaborRate, createMachineRate,
  createModifier, createDiscount, createWorkflow,
  type MigrateBundle, type MigrateDefaultItem, type MigrateModifier,
  type MigrateOptionRate, type MigrateDropdownMenu,
} from './actions'

// ---- ShopVOX data shape ----
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
  modifiers?: {
    name: string
    type: 'Numeric' | 'Boolean' | 'Range'
    default?: string | number | boolean | null
  }[]
  dropdown_menus?: {
    name: string
    kind: 'Material' | 'LaborRate' | 'MachineRate'
    category?: string | null
    optional?: boolean | null
  }[]
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

export type ExistingOptionRate = {
  id: string
  product_id: string
  rate_type: 'labor_rate' | 'machine_rate'
  rate_id: string
  category: string | null
  formula: string | null
  multiplier: number | null
  charge_per_li_unit: boolean | null
  modifier_formula: string | null
  workflow_step: boolean | null
  sort_order: number | null
}

export type MaterialOption = Pick<Material, 'id' | 'name' | 'category_id' | 'multiplier'> & {
  wastage_markup?: number | null
}
export type LaborRateOption = { id: string; name: string; category: string | null; cost: number; markup: number }
export type MachineRateOption = { id: string; name: string; category: string | null; cost: number; markup: number }

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
  materialCategories: Pick<MaterialCategory, 'id' | 'name'>[]
  laborRates: LaborRateOption[]
  machineRates: MachineRateOption[]
  modifiersList: Modifier[]
  existingDefaultItems: ProductDefaultItem[]
  existingOptionRates: ExistingOptionRate[]
  existingModifiers: ProductModifier[]
  existingDropdownMenus: ExistingDropdownMenu[]
}

// ---- Local row types ----
type MaterialRow = { id: string; category_id: string | null; wastage_percent: number; item_markup: number }
type RateRow = { id: string; rate_id: string; formula: string | null; multiplier: number; charge_per_li_unit: boolean; modifier_formula: string | null; workflow_step: boolean }
type ModifierRow = { id: string; modifier_id: string; is_required: boolean; default_value: string | null; display_name: string; modifier_type: string }
type DropdownItemRow = { item_type: 'Material' | 'LaborRate' | 'MachineRate'; material_id: string | null; labor_rate_id: string | null; machine_rate_id: string | null; system_formula: string | null; charge_per_li_unit: boolean; is_optional: boolean; id: string }
type DropdownMenuRow = { id: string; menu_name: string; is_optional: boolean; items: DropdownItemRow[] }

const FORMULA_OPTIONS = ['Area', 'Perimeter', 'Height', 'Width', 'Unit', 'None']
const PRICING_FORMULA_OPTIONS = ['Area', 'Perimeter', 'Width', 'Height', 'Unit']
const UNIT_OPTIONS = ['Each', 'Sqft', 'Roll', 'Sheet', 'Unit', 'Feet', 'Inch', 'Yard', 'Hr']
const ADD_NEW = '__add_new__'

function uid() { return Math.random().toString(36).slice(2, 10) }

export default function MigrateClient({
  orgId, orgName, orgSlug, product, shopvoxData, migrationStatus,
  categories, workflows: initialWorkflows, discounts: initialDiscounts,
  materials, materialCategories: initialMaterialCategories,
  laborRates: initialLaborRates, machineRates: initialMachineRates,
  modifiersList: initialModifiersList,
  existingDefaultItems, existingOptionRates, existingModifiers, existingDropdownMenus,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>(initialWorkflows)
  const [discounts, setDiscounts] = useState<Discount[]>(initialDiscounts)
  const [materialCats, setMaterialCats] = useState<Pick<MaterialCategory, 'id' | 'name'>[]>(initialMaterialCategories)
  const [laborRates, setLaborRates] = useState<LaborRateOption[]>(initialLaborRates)
  const [machineRates, setMachineRates] = useState<MachineRateOption[]>(initialMachineRates)
  const [modifiersList, setModifiersList] = useState<Modifier[]>(initialModifiersList)

  // ---- Lookups ----
  const materialByName = useMemo(() => {
    const m = new Map<string, MaterialOption>()
    for (const mat of materials) m.set(mat.name.toLowerCase().trim(), mat)
    return m
  }, [materials])
  const materialById = useMemo(() => new Map<string, MaterialOption>(materials.map((m: MaterialOption) => [m.id, m] as [string, MaterialOption])), [materials])
  const laborById = useMemo(() => new Map<string, LaborRateOption>(laborRates.map((l: LaborRateOption) => [l.id, l] as [string, LaborRateOption])), [laborRates])
  const machineById = useMemo(() => new Map<string, MachineRateOption>(machineRates.map((m: MachineRateOption) => [m.id, m] as [string, MachineRateOption])), [machineRates])
  const modifierById = useMemo(() => new Map<string, Modifier>(modifiersList.map((m: Modifier) => [m.id, m] as [string, Modifier])), [modifiersList])
  const discountByName = useMemo(() => {
    const m = new Map<string, Discount>()
    for (const d of discounts) m.set(d.name.toLowerCase().trim(), d)
    return m
  }, [discounts])
  const modifierByName = useMemo(() => {
    const m = new Map<string, Modifier>()
    for (const mod of modifiersList) {
      if (mod.system_lookup_name) m.set(mod.system_lookup_name.toLowerCase().trim(), mod)
      m.set(mod.display_name.toLowerCase().trim(), mod)
      m.set(mod.name.toLowerCase().trim(), mod)
    }
    return m
  }, [modifiersList])
  const laborCategories = useMemo(() => {
    const s = new Set<string>()
    for (const r of laborRates) if (r.category) s.add(r.category)
    return Array.from(s).sort()
  }, [laborRates])
  const machineCategories = useMemo(() => {
    const s = new Set<string>()
    for (const r of machineRates) if (r.category) s.add(r.category)
    return Array.from(s).sort()
  }, [machineRates])
  const materialsByCategory = useMemo(() => {
    const m = new Map<string, MaterialOption[]>()
    for (const mat of materials) {
      if (!mat.category_id) continue
      const arr = m.get(mat.category_id) ?? []
      arr.push(mat)
      m.set(mat.category_id, arr)
    }
    return m
  }, [materials])

  // ---- Basic / Pricing state ----
  type BasicState = { name: string; description: string; product_type: string; category_id: string | null; secondary_category: string; workflow_template_id: string | null }
  const [basic, setBasic] = useState<BasicState>({
    name: product.name, description: product.description ?? '', product_type: product.product_type ?? '',
    category_id: product.category_id, secondary_category: product.secondary_category ?? '',
    workflow_template_id: product.workflow_template_id,
  })

  type PricingState = { pricing_type: 'Formula' | 'Basic' | 'Grid' | 'Cost Plus' | null; pricing_method: string | null; formula: string | null; buying_units: string | null; range_discount_id: string | null }
  const [pricing, setPricing] = useState<PricingState>({
    pricing_type: (product.pricing_type as 'Formula' | 'Basic' | 'Grid' | 'Cost Plus' | null) ?? 'Formula',
    pricing_method: product.pricing_method ?? 'Standard',
    formula: product.formula ?? 'Area',
    buying_units: product.buying_units ?? 'Each',
    range_discount_id: product.range_discount_id,
  })

  // ---- Row state ----
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>(() =>
    existingDefaultItems.filter((r) => r.item_type === 'Material').map((r) => {
      const mat = r.material_id ? materialById.get(r.material_id) : undefined
      return { id: uid(), category_id: r.overrides_material_category_id ?? mat?.category_id ?? null, wastage_percent: r.wastage_percent ?? 0, item_markup: r.item_markup ?? mat?.multiplier ?? 1 }
    })
  )
  const [laborRateRows, setLaborRateRows] = useState<RateRow[]>(() =>
    existingOptionRates.filter((r) => r.rate_type === 'labor_rate').map((r) => ({
      id: uid(), rate_id: r.rate_id, formula: r.formula, multiplier: r.multiplier ?? 1,
      charge_per_li_unit: r.charge_per_li_unit ?? false, modifier_formula: r.modifier_formula, workflow_step: r.workflow_step ?? false,
    }))
  )
  const [machineRateRows, setMachineRateRows] = useState<RateRow[]>(() =>
    existingOptionRates.filter((r) => r.rate_type === 'machine_rate').map((r) => ({
      id: uid(), rate_id: r.rate_id, formula: r.formula, multiplier: r.multiplier ?? 1,
      charge_per_li_unit: r.charge_per_li_unit ?? false, modifier_formula: r.modifier_formula, workflow_step: r.workflow_step ?? false,
    }))
  )

  // FIX 3: Pre-populate modifiers from shopvox_data when no saved modifiers
  const [modifierRows, setModifierRows] = useState<ModifierRow[]>(() => {
    const saved = existingModifiers.filter((m) => m.modifier_id)
    if (saved.length > 0) {
      return saved.map((m) => {
        const mod = initialModifiersList.find((x) => x.id === m.modifier_id)
        return { id: uid(), modifier_id: m.modifier_id!, is_required: m.is_required ?? false, default_value: m.default_value, display_name: mod?.display_name ?? 'Unknown', modifier_type: mod?.modifier_type ?? '' }
      })
    }
    const rows: ModifierRow[] = []
    const seen = new Set<string>()
    for (const m of (shopvoxData?.modifiers ?? [])) {
      const lc = m.name.toLowerCase().trim()
      const match =
        initialModifiersList.find((x) => x.system_lookup_name?.toLowerCase().trim() === lc) ||
        initialModifiersList.find((x) => x.display_name.toLowerCase().trim() === lc) ||
        initialModifiersList.find((x) => x.name.toLowerCase().trim() === lc)
      if (!match || seen.has(match.id)) continue
      seen.add(match.id)
      rows.push({ id: uid(), modifier_id: match.id, is_required: false, default_value: m.default != null ? String(m.default) : null, display_name: match.display_name, modifier_type: match.modifier_type })
    }
    return rows
  })

  const [dropdownMenus, setDropdownMenus] = useState<DropdownMenuRow[]>(() =>
    existingDropdownMenus.map((menu) => ({ id: uid(), menu_name: menu.menu_name, is_optional: menu.is_optional, items: menu.items.map((i) => ({ ...i, id: uid() })) }))
  )

  // FIX 1: Universal reviewed checkboxes for every left panel row
  const [reviewedRows, setReviewedRows] = useState<Set<string>>(new Set())
  function toggleReviewed(key: string) {
    setReviewedRows((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  // ---- Copy handlers ----
  function copyBasic() {
    const b = shopvoxData?.basic
    if (!b) return
    setBasic((prev: BasicState) => ({
      ...prev,
      name: b.name ?? prev.name,
      description: b.display_name ?? prev.description,
      product_type: b.type ?? prev.product_type,
      secondary_category: b.secondary_category ?? prev.secondary_category,
      category_id: categories.find((c) => c.name.toLowerCase() === (b.category ?? '').toLowerCase())?.id ?? prev.category_id,
      workflow_template_id: workflows.find((w: WorkflowTemplate) => w.name.toLowerCase() === (b.workflow ?? '').toLowerCase())?.id ?? prev.workflow_template_id,
    }))
    showToast('Copied basic info')
  }

  function copyPricing() {
    const p = shopvoxData?.pricing
    if (!p) return
    setPricing((prev: PricingState) => ({
      ...prev,
      pricing_type: (p.pricing_type as 'Formula' | 'Basic' | 'Grid' | 'Cost Plus') ?? prev.pricing_type,
      pricing_method: p.pricing_method ?? prev.pricing_method,
      formula: p.formula ?? prev.formula,
      buying_units: p.buying_units ?? prev.buying_units,
      range_discount_id: discountByName.get((p.range_discount ?? '').toLowerCase())?.id ?? prev.range_discount_id,
    }))
    showToast('Copied pricing')
  }

  function copyShopvoxModifier(m: NonNullable<ShopvoxData['modifiers']>[number]) {
    const match = modifierByName.get(m.name.toLowerCase().trim())
    if (!match) { showToast(`No match in DB for modifier "${m.name}"`); return }
    if (modifierRows.some((r: ModifierRow) => r.modifier_id === match.id)) { showToast(`"${match.display_name}" already added`); return }
    setModifierRows((rows: ModifierRow[]) => [...rows, { id: uid(), modifier_id: match.id, is_required: false, default_value: m.default != null ? String(m.default) : null, display_name: match.display_name, modifier_type: match.modifier_type }])
  }

  function copyAllShopvoxModifiers() {
    const list = shopvoxData?.modifiers ?? []
    let added = 0, missing = 0
    setModifierRows((rows: ModifierRow[]) => {
      const next = [...rows]
      const existingIds = new Set(rows.map((r: ModifierRow) => r.modifier_id))
      for (const m of list) {
        const match = modifierByName.get(m.name.toLowerCase().trim())
        if (!match) { missing++; continue }
        if (existingIds.has(match.id)) continue
        existingIds.add(match.id)
        next.push({ id: uid(), modifier_id: match.id, is_required: false, default_value: m.default != null ? String(m.default) : null, display_name: match.display_name, modifier_type: match.modifier_type })
        added++
      }
      return next
    })
    showToast(`Added ${added} modifiers${missing ? `, ${missing} had no match` : ''}`)
  }

  function copyShopvoxDropdown(m: NonNullable<ShopvoxData['dropdown_menus']>[number]) {
    setDropdownMenus((menus: DropdownMenuRow[]) => [...menus, { id: uid(), menu_name: m.name, is_optional: m.optional ?? false, items: [] }])
    showToast(`Added menu "${m.name}"`)
  }

  function copyAllShopvoxDropdowns() {
    const list = shopvoxData?.dropdown_menus ?? []
    setDropdownMenus((menus: DropdownMenuRow[]) => [...menus, ...list.map((m) => ({ id: uid(), menu_name: m.name, is_optional: m.optional ?? false, items: [] as DropdownItemRow[] }))])
    showToast(`Added ${list.length} dropdown menus`)
  }

  function addShopvoxDefaultItem(it: NonNullable<ShopvoxData['default_items']>[number]) {
    const lcName = it.name.toLowerCase().trim()
    if (it.kind === 'Material') {
      const match = materialByName.get(lcName)
      setMaterialRows((rows: MaterialRow[]) => [...rows, { id: uid(), category_id: match?.category_id ?? null, wastage_percent: 0, item_markup: match?.multiplier ?? 1 }])
    } else if (it.kind === 'LaborRate') {
      const match = laborRates.find((l: LaborRateOption) => l.name.toLowerCase().trim() === lcName)
      if (!match) { showToast(`No labor rate match for "${it.name}"`); return }
      if (laborRateRows.some((r: RateRow) => r.rate_id === match.id)) return
      setLaborRateRows((rows: RateRow[]) => [...rows, { id: uid(), rate_id: match.id, formula: it.formula || 'Area', multiplier: it.multiplier ?? 1, charge_per_li_unit: it.per_li, modifier_formula: it.modifier?.expression ?? null, workflow_step: true }])
    } else {
      const match = machineRates.find((m: MachineRateOption) => m.name.toLowerCase().trim() === lcName)
      if (!match) { showToast(`No machine rate match for "${it.name}"`); return }
      if (machineRateRows.some((r: RateRow) => r.rate_id === match.id)) return
      setMachineRateRows((rows: RateRow[]) => [...rows, { id: uid(), rate_id: match.id, formula: it.formula || 'Area', multiplier: it.multiplier ?? 1, charge_per_li_unit: it.per_li, modifier_formula: it.modifier?.expression ?? null, workflow_step: true }])
    }
  }

  function copyAllShopvoxDefaultItems() { for (const it of (shopvoxData?.default_items ?? [])) addShopvoxDefaultItem(it); showToast(`Added items`) }
  // FIX 6: Copy All for Materials section
  function copyAllShopvoxMaterials() { const list = (shopvoxData?.default_items ?? []).filter((it) => it.kind === 'Material'); for (const it of list) addShopvoxDefaultItem(it); showToast(`Added ${list.length} materials`) }
  // FIX 6: Copy All for Rates sections
  function copyAllShopvoxRates() { const list = (shopvoxData?.default_items ?? []).filter((it) => it.kind !== 'Material'); for (const it of list) addShopvoxDefaultItem(it); showToast(`Added ${list.length} rates`) }

  // ---- Row actions ----
  function addBlankMaterial() { setMaterialRows((rows: MaterialRow[]) => [...rows, { id: uid(), category_id: null, wastage_percent: 0, item_markup: 1 }]) }
  function updateMaterial(id: string, patch: Partial<MaterialRow>) { setMaterialRows((rows: MaterialRow[]) => rows.map((r: MaterialRow) => (r.id === id ? { ...r, ...patch } : r))) }
  function deleteMaterial(id: string) { setMaterialRows((rows: MaterialRow[]) => rows.filter((r: MaterialRow) => r.id !== id)) }

  function addRatesByCategory(kind: 'LaborRate' | 'MachineRate', rateIds: string[]) {
    const setter = kind === 'LaborRate' ? setLaborRateRows : setMachineRateRows
    setter((rows: RateRow[]) => {
      const existing = new Set(rows.map((r: RateRow) => r.rate_id))
      return [...rows, ...rateIds.filter((id) => !existing.has(id)).map<RateRow>((rate_id) => ({ id: uid(), rate_id, formula: 'Area', multiplier: 1, charge_per_li_unit: false, modifier_formula: null, workflow_step: false }))]
    })
  }
  function updateRate(kind: 'LaborRate' | 'MachineRate', id: string, patch: Partial<RateRow>) {
    const setter = kind === 'LaborRate' ? setLaborRateRows : setMachineRateRows
    setter((rows: RateRow[]) => rows.map((r: RateRow) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function deleteRate(kind: 'LaborRate' | 'MachineRate', id: string) {
    const setter = kind === 'LaborRate' ? setLaborRateRows : setMachineRateRows
    setter((rows: RateRow[]) => rows.filter((r: RateRow) => r.id !== id))
  }
  function updateModifier(id: string, patch: Partial<MigrateModifier>) { setModifierRows((rows: ModifierRow[]) => rows.map((r: ModifierRow) => (r.id === id ? { ...r, ...patch } : r))) }
  function deleteModifier(id: string) { setModifierRows((rows: ModifierRow[]) => rows.filter((r: ModifierRow) => r.id !== id)) }
  function addModifierById(modifierId: string) {
    const mod = modifierById.get(modifierId)
    if (!mod) return
    if (modifierRows.some((r: ModifierRow) => r.modifier_id === modifierId)) { showToast(`"${mod.display_name}" already added`); return }
    setModifierRows((rows: ModifierRow[]) => [...rows, { id: uid(), modifier_id: modifierId, is_required: false, default_value: null, display_name: mod.display_name, modifier_type: mod.modifier_type }])
  }
  function addBlankMenu() { setDropdownMenus((menus: DropdownMenuRow[]) => [...menus, { id: uid(), menu_name: 'New menu', is_optional: false, items: [] }]) }
  function updateMenu(id: string, patch: Partial<Pick<DropdownMenuRow, 'menu_name' | 'is_optional'>>) { setDropdownMenus((menus: DropdownMenuRow[]) => menus.map((m: DropdownMenuRow) => (m.id === id ? { ...m, ...patch } : m))) }
  function deleteMenu(id: string) { setDropdownMenus((menus: DropdownMenuRow[]) => menus.filter((m: DropdownMenuRow) => m.id !== id)) }

  // ---- DnD ----
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  function reorder<T extends { id: string }>(rows: T[], active: string, over: string): T[] {
    const o = rows.findIndex((r) => r.id === active)
    const n = rows.findIndex((r) => r.id === over)
    if (o < 0 || n < 0) return rows
    return arrayMove(rows, o, n)
  }
  function onLaborDragEnd(e: DragEndEvent) { const { active, over } = e; if (!over || active.id === over.id) return; setLaborRateRows((rows: RateRow[]) => reorder(rows, String(active.id), String(over.id))) }
  function onMachineDragEnd(e: DragEndEvent) { const { active, over } = e; if (!over || active.id === over.id) return; setMachineRateRows((rows: RateRow[]) => reorder(rows, String(active.id), String(over.id))) }
  function onModifierDragEnd(e: DragEndEvent) { const { active, over } = e; if (!over || active.id === over.id) return; setModifierRows((rows: ModifierRow[]) => reorder(rows, String(active.id), String(over.id))) }

  // ---- Bundle ----
  function buildBundle(): MigrateBundle {
    return {
      basic: { name: basic.name, description: basic.description || null, product_type: basic.product_type || null, category_id: basic.category_id, secondary_category: basic.secondary_category || null, workflow_template_id: basic.workflow_template_id },
      pricing: { pricing_type: pricing.pricing_type, pricing_method: pricing.pricing_method, formula: pricing.formula, buying_units: pricing.buying_units, range_discount_id: pricing.range_discount_id },
      defaultItems: materialRows.map<MigrateDefaultItem>((r: MaterialRow) => ({ item_type: 'Material', material_id: null, labor_rate_id: null, machine_rate_id: null, custom_item_name: null, system_formula: null, multiplier: 1, charge_per_li_unit: false, include_in_base_price: true, menu_name: null, is_optional: false, workflow_step: false, modifier_formula: null, wastage_percent: r.wastage_percent, item_markup: r.item_markup, overrides_material_category_id: r.category_id })),
      optionRates: [
        ...laborRateRows.map<MigrateOptionRate>((r: RateRow) => ({ rate_type: 'labor_rate', rate_id: r.rate_id, category: laborById.get(r.rate_id)?.category ?? null, formula: r.formula, multiplier: r.multiplier, charge_per_li_unit: r.charge_per_li_unit, modifier_formula: r.modifier_formula, workflow_step: r.workflow_step })),
        ...machineRateRows.map<MigrateOptionRate>((r: RateRow) => ({ rate_type: 'machine_rate', rate_id: r.rate_id, category: machineById.get(r.rate_id)?.category ?? null, formula: r.formula, multiplier: r.multiplier, charge_per_li_unit: r.charge_per_li_unit, modifier_formula: r.modifier_formula, workflow_step: r.workflow_step })),
      ],
      modifiers: modifierRows.map((r: ModifierRow) => ({ modifier_id: r.modifier_id, is_required: r.is_required, default_value: r.default_value })),
      dropdownMenus: dropdownMenus.map<MigrateDropdownMenu>((m: DropdownMenuRow) => ({ menu_name: m.menu_name, is_optional: m.is_optional, items: m.items.map((i: DropdownItemRow) => ({ item_type: i.item_type, material_id: i.material_id, labor_rate_id: i.labor_rate_id, machine_rate_id: i.machine_rate_id, system_formula: i.system_formula, charge_per_li_unit: i.charge_per_li_unit, is_optional: i.is_optional })) })),
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

  const workflowSteps = useMemo(() => {
    const steps: { kind: 'LaborRate' | 'MachineRate'; name: string; row: RateRow }[] = []
    for (const r of laborRateRows) { if (!r.workflow_step) continue; steps.push({ kind: 'LaborRate', name: laborById.get(r.rate_id)?.name ?? 'Unknown labor rate', row: r }) }
    for (const r of machineRateRows) { if (!r.workflow_step) continue; steps.push({ kind: 'MachineRate', name: machineById.get(r.rate_id)?.name ?? 'Unknown machine rate', row: r }) }
    return steps
  }, [laborRateRows, machineRateRows, laborById, machineById])

  // ---- Inline create handlers ----
  async function handleCreateMaterialCategory(name: string): Promise<string | null> {
    const res = await createMaterialCategory(orgId, name)
    if (res.error || !res.row) { setFormError(res.error ?? 'Failed'); return null }
    setMaterialCats((list: Pick<MaterialCategory, 'id' | 'name'>[]) => [...list, res.row!].sort((a, b) => a.name.localeCompare(b.name)))
    showToast(`Created category "${res.row.name}"`); return res.row.id
  }
  async function handleCreateWorkflow(name: string): Promise<string | null> {
    const res = await createWorkflow(orgId, { name })
    if (res.error || !res.row) { setFormError(res.error ?? 'Failed'); return null }
    const wt: WorkflowTemplate = { ...res.row, organization_id: orgId, description: null, template_type: null, active: true, created_at: new Date().toISOString(), created_by: null, updated_at: new Date().toISOString() }
    setWorkflows((list: WorkflowTemplate[]) => [...list, wt].sort((a: WorkflowTemplate, b: WorkflowTemplate) => a.name.localeCompare(b.name)))
    showToast(`Created workflow "${res.row.name}"`); return res.row.id
  }
  async function handleCreateDiscount(name: string, discount_type: 'Range' | 'Volume' | 'Price'): Promise<string | null> {
    const res = await createDiscount(orgId, { name, discount_type })
    if (res.error || !res.row) { setFormError(res.error ?? 'Failed'); return null }
    const d: Discount = { id: res.row.id, name: res.row.name, discount_type: res.row.discount_type as Discount['discount_type'], organization_id: orgId, applies_to: 'Product', discount_by: 'Percentage', active: true, created_at: new Date().toISOString(), created_by: null, updated_at: new Date().toISOString() }
    setDiscounts((list: Discount[]) => [...list, d].sort((a: Discount, b: Discount) => a.name.localeCompare(b.name)))
    showToast(`Created discount "${res.row.name}"`); return res.row.id
  }
  async function handleCreateModifier(name: string, modifier_type: 'Boolean' | 'Numeric' | 'Range', default_value: string | null): Promise<string | null> {
    const res = await createModifier(orgId, { name, modifier_type, default_value })
    if (res.error || !res.row) { setFormError(res.error ?? 'Failed'); return null }
    const mod: Modifier = { id: res.row.id, name: res.row.name, display_name: res.row.display_name, modifier_type: res.row.modifier_type as Modifier['modifier_type'], organization_id: orgId, system_lookup_name: null, units: null, range_min_label: null, range_max_label: null, range_min_value: null, range_max_value: null, range_default_value: null, range_step_interval: null, show_internally: null, show_customer: null, is_system_variable: null, active: true, created_at: new Date().toISOString(), created_by: null, updated_at: new Date().toISOString(), updated_by: null }
    setModifiersList((list: Modifier[]) => [...list, mod].sort((a: Modifier, b: Modifier) => a.display_name.localeCompare(b.display_name)))
    showToast(`Created modifier "${res.row.display_name}"`); return res.row.id
  }
  async function handleCreateLaborRate(input: { name: string; category: string; cost: number; markup: number }): Promise<string | null> {
    const res = await createLaborRate(orgId, input)
    if (res.error || !res.row) { setFormError(res.error ?? 'Failed'); return null }
    const rate: LaborRateOption = { id: res.row.id, name: res.row.name, category: res.row.category, cost: res.row.cost, markup: res.row.markup }
    setLaborRates((list: LaborRateOption[]) => [...list, rate].sort((a: LaborRateOption, b: LaborRateOption) => a.name.localeCompare(b.name)))
    addRatesByCategory('LaborRate', [res.row.id]); showToast(`Created labor rate "${res.row.name}"`); return res.row.id
  }
  async function handleCreateMachineRate(input: { name: string; category: string; cost: number; markup: number }): Promise<string | null> {
    const res = await createMachineRate(orgId, input)
    if (res.error || !res.row) { setFormError(res.error ?? 'Failed'); return null }
    const rate: MachineRateOption = { id: res.row.id, name: res.row.name, category: res.row.category, cost: res.row.cost, markup: res.row.markup }
    setMachineRates((list: MachineRateOption[]) => [...list, rate].sort((a: MachineRateOption, b: MachineRateOption) => a.name.localeCompare(b.name)))
    addRatesByCategory('MachineRate', [res.row.id]); showToast(`Created machine rate "${res.row.name}"`); return res.row.id
  }

  const statusBadge = migrationStatus === 'printos_ready'
    ? { label: 'PrintOS Ready', cls: 'bg-green-100 text-green-700 border-green-200' }
    : migrationStatus === 'in_progress'
      ? { label: 'In Progress', cls: 'bg-amber-100 text-amber-800 border-amber-200' }
      : { label: 'ShopVOX Reference', cls: 'bg-gray-100 text-gray-700 border-gray-200' }

  const hasShopvox = !!shopvoxData
  // FIX 6: derived left panel data
  const svMaterials = (shopvoxData?.default_items ?? []).filter((it) => it.kind === 'Material')
  const svRates = (shopvoxData?.default_items ?? []).filter((it) => it.kind !== 'Material')

  return (
    // FIX 2: flex col container, full viewport height minus header
    <div className="flex flex-col bg-gray-50 overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-green-800">{toast}</span>
        </div>
      )}

      {/* Top Bar */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
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
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge.cls}`}>{statusBadge.label}</span>
            {formError && <span className="text-xs text-red-600">{formError}</span>}
            <button onClick={handleSaveDraft} disabled={isPending} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {isPending ? 'Saving...' : 'Save Draft'}
            </button>
            <button onClick={handlePublish} disabled={isPending} className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
              {isPending ? 'Publishing...' : 'Publish to PrintOS'}
            </button>
          </div>
        </div>
      </div>

      {/* Two-column body — flex row, 30/70 split, each column independently scrollable */}
      <div className="flex-1 flex flex-row min-h-0 gap-4 p-4 overflow-hidden">

        {/* LEFT 30% — independently scrollable */}
        <div className="w-[30%] shrink-0 min-h-0 overflow-y-auto pr-1 space-y-3">
          <SectionHeaderLeft />
          {!hasShopvox && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
              No ShopVOX reference data saved for this product.
            </div>
          )}
          {hasShopvox && (
            <>
              {/* 1. Basic Info */}
              <LeftSection title="Basic Info" onCopyAll={copyBasic} canCopy>
                {([
                  ['Name', shopvoxData!.basic?.name],
                  ['Display Name', shopvoxData!.basic?.display_name],
                  ['Type', shopvoxData!.basic?.type],
                  ['Workflow', shopvoxData!.basic?.workflow],
                  ['Category', shopvoxData!.basic?.category],
                  ['Secondary Category', shopvoxData!.basic?.secondary_category],
                ] as [string, string | null | undefined][]).map(([k, v], i) => {
                  const rKey = `basic:${i}`
                  return (
                    <LeftCheckRow key={i} rowKey={rKey} reviewed={reviewedRows.has(rKey)} onToggle={() => toggleReviewed(rKey)}>
                      <KV k={k} v={v} />
                    </LeftCheckRow>
                  )
                })}
              </LeftSection>

              {/* 2. Pricing */}
              <LeftSection title="Pricing" onCopyAll={copyPricing} canCopy>
                {([
                  ['Pricing Type', shopvoxData!.pricing?.pricing_type],
                  ['Formula', shopvoxData!.pricing?.formula],
                  ['Method', shopvoxData!.pricing?.pricing_method],
                  ['Buying Units', shopvoxData!.pricing?.buying_units],
                  ['Range Discount', shopvoxData!.pricing?.range_discount],
                  ['Apply Discounts', shopvoxData!.pricing?.apply_discounts == null ? '—' : shopvoxData!.pricing.apply_discounts ? 'Yes' : 'No'],
                ] as [string, string | null | undefined][]).map(([k, v], i) => {
                  const rKey = `pricing:${i}`
                  return (
                    <LeftCheckRow key={i} rowKey={rKey} reviewed={reviewedRows.has(rKey)} onToggle={() => toggleReviewed(rKey)}>
                      <KV k={k} v={v} />
                    </LeftCheckRow>
                  )
                })}
              </LeftSection>

              {/* 3. Modifiers */}
              <LeftSection title={`Modifiers (${shopvoxData!.modifiers?.length ?? 0})`} onCopyAll={copyAllShopvoxModifiers} canCopy={!!shopvoxData!.modifiers?.length}>
                {(shopvoxData!.modifiers ?? []).map((m, i) => {
                  const rKey = `mod:${i}`
                  return (
                    <LeftCheckRow key={i} rowKey={rKey} reviewed={reviewedRows.has(rKey)} onToggle={() => toggleReviewed(rKey)} onCopy={() => copyShopvoxModifier(m)}>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.type === 'Boolean' ? 'bg-blue-100 text-blue-700' : m.type === 'Numeric' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>{m.type}</span>
                        <span className="text-sm font-medium text-gray-800 truncate">{m.name}</span>
                        <span className="text-xs text-gray-400 ml-auto">{typeof m.default === 'boolean' ? String(m.default) : (m.default ?? '')}</span>
                      </div>
                    </LeftCheckRow>
                  )
                })}
              </LeftSection>

              {/* 4. Dropdown Menus */}
              <LeftSection title={`Dropdown Menus (${shopvoxData!.dropdown_menus?.length ?? 0})`} onCopyAll={copyAllShopvoxDropdowns} canCopy={!!shopvoxData!.dropdown_menus?.length}>
                {(shopvoxData!.dropdown_menus ?? []).map((m, i) => {
                  const rKey = `dd:${i}`
                  return (
                    <LeftCheckRow key={i} rowKey={rKey} reviewed={reviewedRows.has(rKey)} onToggle={() => toggleReviewed(rKey)} onCopy={() => copyShopvoxDropdown(m)}>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-700">{m.kind}</span>
                        <span className="text-sm font-medium text-gray-800 truncate">{m.name}</span>
                        {m.optional && <span className="text-[10px] text-gray-400 ml-auto">optional</span>}
                        {m.category && <span className="text-[10px] text-gray-400">{m.category}</span>}
                      </div>
                    </LeftCheckRow>
                  )
                })}
              </LeftSection>

              {/* 5. Materials (from default_items where kind=Material) */}
              <LeftSection title={`Materials (${svMaterials.length})`} onCopyAll={copyAllShopvoxMaterials} canCopy={svMaterials.length > 0}>
                {svMaterials.length === 0 && <div className="text-xs text-gray-400 italic px-2 py-1">No material items in default items.</div>}
                {svMaterials.map((it, i) => {
                  const rKey = `mat:${i}`
                  return (
                    <LeftCheckRow key={i} rowKey={rKey} reviewed={reviewedRows.has(rKey)} onToggle={() => toggleReviewed(rKey)} onCopy={() => addShopvoxDefaultItem(it)}>
                      <div className="flex items-start gap-1.5">
                        <TypeBadge kind="Material" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium truncate block">{it.name}</span>
                          <div className="flex gap-2 text-xs text-gray-500">
                            <span>Formula: {it.formula}</span>
                            <span>× {it.multiplier}</span>
                            {it.per_li && <span className="text-amber-600">Per LI</span>}
                          </div>
                        </div>
                      </div>
                    </LeftCheckRow>
                  )
                })}
              </LeftSection>

              {/* 6. Labor & Machine Rates (default_items) */}
              <LeftSection title={`Labor & Machine Rates (${svRates.length})`} onCopyAll={copyAllShopvoxRates} canCopy={svRates.length > 0}>
                {svRates.length === 0 && <div className="text-xs text-gray-400 italic px-2 py-1">No labor/machine items in default items.</div>}
                {svRates.map((it, i) => {
                  const rKey = `di:${i}`
                  const reviewed = reviewedRows.has(rKey)
                  return (
                    <LeftCheckRow key={i} rowKey={rKey} reviewed={reviewed} onToggle={() => toggleReviewed(rKey)} onCopy={() => addShopvoxDefaultItem(it)}>
                      <div className={`space-y-0.5 transition-all ${reviewed ? 'line-through text-gray-400' : ''}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-gray-400 w-5 shrink-0">#{it.idx ?? i + 1}</span>
                          <TypeBadge kind={it.kind} />
                          <span className="text-sm font-medium truncate">{it.name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs pl-7">
                          <span>Formula: {it.formula}</span>
                          <span>× {it.multiplier}</span>
                          {it.per_li && <span className={reviewed ? '' : 'text-amber-600'}>Per LI</span>}
                          {it.modifier && <span className="truncate" title={it.modifier.expression}>Mod: {it.modifier.expression}</span>}
                        </div>
                        {it.note && <div className="text-[11px] italic pl-7">{it.note}</div>}
                      </div>
                    </LeftCheckRow>
                  )
                })}
              </LeftSection>


            </>
          )}
        </div>

        {/* RIGHT 70% — independently scrollable */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto pr-1 space-y-4">
          <SectionHeaderRight />

          {/* 1. Basic Info */}
          <RightSection title="Basic Info">
            <FieldRow label="Name">
              <input className={inputCls} value={basic.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBasic((p: BasicState) => ({ ...p, name: e.target.value }))} />
            </FieldRow>
            <FieldRow label="Description">
              <input className={inputCls} value={basic.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBasic((p: BasicState) => ({ ...p, description: e.target.value }))} />
            </FieldRow>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Type">
                <input className={inputCls} value={basic.product_type} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBasic((p: BasicState) => ({ ...p, product_type: e.target.value }))} />
              </FieldRow>
              <FieldRow label="Workflow">
                <SelectWithAdd value={basic.workflow_template_id ?? ''} onChange={(v) => setBasic((p: BasicState) => ({ ...p, workflow_template_id: v || null }))} options={workflows.map((w: WorkflowTemplate) => ({ value: w.id, label: w.name }))} addLabel="+ Add New Workflow" renderAddForm={(close) => (<AddWorkflowForm onCancel={close} onSubmit={async (name) => { const id = await handleCreateWorkflow(name); if (id) { setBasic((p: BasicState) => ({ ...p, workflow_template_id: id })); close() } }} />)} />
              </FieldRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Category">
                <select className={inputCls} value={basic.category_id ?? ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setBasic((p: BasicState) => ({ ...p, category_id: e.target.value || null }))}>
                  <option value="">— None —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Secondary Category">
                <input className={inputCls} value={basic.secondary_category} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBasic((p: BasicState) => ({ ...p, secondary_category: e.target.value }))} />
              </FieldRow>
            </div>
          </RightSection>

          {/* 2. Pricing */}
          <RightSection title="Pricing">
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Pricing Type">
                <select className={inputCls} value={pricing.pricing_type ?? ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPricing((p: PricingState) => ({ ...p, pricing_type: (e.target.value || null) as PricingState['pricing_type'] }))}>
                  <option value="Formula">Formula</option><option value="Basic">Basic</option><option value="Grid">Grid</option><option value="Cost Plus">Cost Plus</option>
                </select>
              </FieldRow>
              <FieldRow label="Method">
                <select className={inputCls} value={pricing.pricing_method ?? ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPricing((p: PricingState) => ({ ...p, pricing_method: e.target.value || null }))}>
                  <option value="Standard">Standard</option><option value="Cost Plus">Cost Plus</option>
                </select>
              </FieldRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Formula">
                <select className={inputCls} value={pricing.formula ?? ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPricing((p: PricingState) => ({ ...p, formula: e.target.value || null }))}>
                  {PRICING_FORMULA_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Buying Units">
                <select className={inputCls} value={pricing.buying_units ?? ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPricing((p: PricingState) => ({ ...p, buying_units: e.target.value || null }))}>
                  <option value="">—</option>
                  {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </FieldRow>
            </div>
            <FieldRow label="Range Discount">
              <SelectWithAdd value={pricing.range_discount_id ?? ''} onChange={(v) => setPricing((p: PricingState) => ({ ...p, range_discount_id: v || null }))} options={discounts.filter((d: Discount) => d.discount_type === 'Range').map((d: Discount) => ({ value: d.id, label: d.name }))} addLabel="+ Add New Discount" renderAddForm={(close) => (<AddDiscountForm onCancel={close} onSubmit={async (name, type) => { const id = await handleCreateDiscount(name, type); if (id) { setPricing((p: PricingState) => ({ ...p, range_discount_id: id })); close() } }} />)} />
            </FieldRow>
          </RightSection>

          {/* 3. Modifiers — FIX 5: purple left border */}
          <ColoredSection title={`Modifiers (${modifierRows.length})`} borderColor="border-l-purple-500">
            <div className="mb-2">
              <SelectWithAdd value="" onChange={(v) => { if (v) addModifierById(v) }} options={modifiersList.filter((m: Modifier) => !modifierRows.some((r: ModifierRow) => r.modifier_id === m.id)).map((m: Modifier) => ({ value: m.id, label: `${m.display_name} (${m.modifier_type})` }))} placeholder="— Add modifier —" addLabel="+ Add New Modifier" renderAddForm={(close) => (<AddModifierForm onCancel={close} onSubmit={async (name, type, def) => { const id = await handleCreateModifier(name, type, def); if (id) { addModifierById(id); close() } }} />)} />
            </div>
            {modifierRows.length === 0 ? <EmptyState text="No modifiers yet." /> : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onModifierDragEnd}>
                <SortableContext items={modifierRows.map((m: ModifierRow) => m.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {modifierRows.map((m: ModifierRow) => <SortableModifierRow key={m.id} row={m} onUpdate={updateModifier} onDelete={deleteModifier} />)}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </ColoredSection>

          {/* 4. Dropdown Menus — FIX 5: gray left border */}
          <ColoredSection title={`Dropdown Menus (${dropdownMenus.length})`} borderColor="border-l-gray-400" action={<AddBtn onClick={addBlankMenu}>Add Menu</AddBtn>}>
            {dropdownMenus.length === 0 ? <EmptyState text="No dropdown menus yet." /> : (
              <div className="space-y-2">
                {dropdownMenus.map((m: DropdownMenuRow) => (
                  <div key={m.id} className="rounded-md border border-gray-200 bg-white p-2">
                    <div className="flex items-center gap-2">
                      <input className="flex-1 rounded border border-gray-200 px-2 py-1 text-sm font-medium focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" value={m.menu_name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateMenu(m.id, { menu_name: e.target.value })} />
                      <label className="flex items-center gap-1 text-[11px] text-gray-500"><input type="checkbox" checked={m.is_optional} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateMenu(m.id, { is_optional: e.target.checked })} className="accent-qm-lime" />optional</label>
                      <button onClick={() => deleteMenu(m.id)} className="rounded p-1 text-red-500 hover:bg-red-50"><XIcon /></button>
                    </div>
                    {m.items.length > 0 && <div className="mt-1 pl-2 text-[11px] text-gray-500">{m.items.length} items</div>}
                  </div>
                ))}
              </div>
            )}
          </ColoredSection>

          {/* 5. Materials — FIX 5: blue left border */}
          <ColoredSection title={`Materials (${materialRows.length})`} borderColor="border-l-blue-500" action={<AddBtn onClick={addBlankMaterial}>Add Material</AddBtn>}>
            {materialRows.length === 0 ? <EmptyState text="No materials yet. Click Add Material to start." /> : (
              <MaterialTable rows={materialRows} materialCats={materialCats} materialsByCategory={materialsByCategory} onCreateCategory={handleCreateMaterialCategory} onUpdate={updateMaterial} onDelete={deleteMaterial} />
            )}
          </ColoredSection>

          {/* 6. Labor + Machine Rates side-by-side — FIX 4: Add by Name + Add by Category */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <RateSection kind="LaborRate" title="Labor Rates" borderColor="border-l-green-500" rows={laborRateRows} rates={laborRates} rateCategories={laborCategories} ratesById={laborById} onAddRates={(ids) => addRatesByCategory('LaborRate', ids)} onUpdate={updateRate} onDelete={deleteRate} sensors={sensors} onDragEnd={onLaborDragEnd} onCreateRate={handleCreateLaborRate} />
            <RateSection kind="MachineRate" title="Machine Rates" borderColor="border-l-orange-500" rows={machineRateRows} rates={machineRates} rateCategories={machineCategories} ratesById={machineById} onAddRates={(ids) => addRatesByCategory('MachineRate', ids)} onUpdate={updateRate} onDelete={deleteRate} sensors={sensors} onDragEnd={onMachineDragEnd} onCreateRate={handleCreateMachineRate} />
          </div>

          {/* 7. Workflow Steps — FIX 5: indigo left border */}
          <ColoredSection title={`Workflow Steps (${workflowSteps.length})`} borderColor="border-l-indigo-500">
            {workflowSteps.length === 0 ? <EmptyState text="Check the Workflow ☑ box on any Labor or Machine rate to make it a step." /> : (
              <ol className="space-y-1">
                {workflowSteps.map((s: { kind: 'LaborRate' | 'MachineRate'; name: string; row: RateRow }, i: number) => (
                  <li key={`${s.kind}-${s.row.id}`} className="flex items-center gap-2 rounded-md border border-gray-100 bg-white px-2 py-1.5">
                    <span className="text-[11px] font-mono font-semibold text-gray-400 w-6 shrink-0">{i + 1}.</span>
                    <input type="checkbox" checked readOnly className="accent-purple-600 h-4 w-4" />
                    <TypeBadge kind={s.kind} />
                    <span className="text-sm font-medium text-gray-800 truncate">{s.name}</span>
                    <span className="ml-auto text-[11px] text-gray-500 flex items-center gap-2">
                      <span>{s.row.formula ?? '—'}</span>
                      <span className="text-gray-400">×</span>
                      <span className="tabular-nums">{s.row.multiplier}</span>
                      {s.row.charge_per_li_unit && <span className="text-amber-600">Per Qty</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </ColoredSection>
          <div className="h-6" />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Sub-components
// ============================================================

function MaterialTable({ rows, materialCats, materialsByCategory, onCreateCategory, onUpdate, onDelete }: { rows: MaterialRow[]; materialCats: Pick<MaterialCategory, 'id' | 'name'>[]; materialsByCategory: Map<string, MaterialOption[]>; onCreateCategory: (name: string) => Promise<string | null>; onUpdate: (id: string, patch: Partial<MaterialRow>) => void; onDelete: (id: string) => void }) {
  const GRID = 'grid grid-cols-[minmax(180px,2fr)_96px_96px_36px] items-center gap-2 px-2 py-1.5'
  return (
    <div className="divide-y divide-gray-100">
      <div className={`${GRID} bg-gray-50 text-xs font-medium uppercase tracking-wider text-gray-500`}><span>Category</span><span>Wastage %</span><span>Markup (x)</span><span /></div>
      {rows.map((row: MaterialRow) => <MaterialRowUI key={row.id} row={row} grid={GRID} materialCats={materialCats} materialsByCategory={materialsByCategory} onCreateCategory={onCreateCategory} onUpdate={onUpdate} onDelete={onDelete} />)}
    </div>
  )
}

function MaterialRowUI({ row, grid, materialCats, materialsByCategory, onCreateCategory, onUpdate, onDelete }: { row: MaterialRow; grid: string; materialCats: Pick<MaterialCategory, 'id' | 'name'>[]; materialsByCategory: Map<string, MaterialOption[]>; onCreateCategory: (name: string) => Promise<string | null>; onUpdate: (id: string, patch: Partial<MaterialRow>) => void; onDelete: (id: string) => void }) {
  const [showAddForm, setShowAddForm] = useState(false)
  function handleCategoryChange(value: string) {
    if (value === ADD_NEW) { setShowAddForm(true); return }
    const categoryId = value || null
    const patch: Partial<MaterialRow> = { category_id: categoryId }
    if (categoryId) {
      const firstMat = materialsByCategory.get(categoryId)?.[0]
      if (firstMat) { patch.item_markup = firstMat.multiplier ?? 1; patch.wastage_percent = firstMat.wastage_markup ?? 0 }
    }
    onUpdate(row.id, patch)
  }
  return (
    <>
      <div className={`${grid} hover:bg-gray-50`}>
        <select className="h-7 rounded border border-gray-200 px-1.5 text-xs" value={row.category_id ?? ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleCategoryChange(e.target.value)}>
          <option value="">— Select category —</option>
          {materialCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value={ADD_NEW}>+ Add Category</option>
        </select>
        <input type="number" step="0.01" className="h-7 rounded border border-gray-200 px-1.5 text-xs tabular-nums" value={Number.isFinite(row.wastage_percent) ? row.wastage_percent : 0} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(row.id, { wastage_percent: parseFloat(e.target.value) || 0 })} />
        <input type="number" step="0.01" className="h-7 rounded border border-gray-200 px-1.5 text-xs tabular-nums" value={Number.isFinite(row.item_markup) ? row.item_markup : 1} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(row.id, { item_markup: parseFloat(e.target.value) || 0 })} />
        <button onClick={() => onDelete(row.id)} className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600" title="Delete"><TrashIcon /></button>
      </div>
      {showAddForm && <div className="px-2 py-2"><AddCategoryForm onCancel={() => setShowAddForm(false)} onSubmit={async (name) => { const id = await onCreateCategory(name); if (id) { onUpdate(row.id, { category_id: id }); setShowAddForm(false) } }} /></div>}
    </>
  )
}

// FIX 4: RateSection — Add by Name search + Add by Category checklist
function RateSection({ kind, title, borderColor, rows, rates, rateCategories, ratesById, onAddRates, onUpdate, onDelete, sensors, onDragEnd, onCreateRate }: { kind: 'LaborRate' | 'MachineRate'; title: string; borderColor: string; rows: RateRow[]; rates: (LaborRateOption | MachineRateOption)[]; rateCategories: string[]; ratesById: Map<string, LaborRateOption | MachineRateOption>; onAddRates: (ids: string[]) => void; onUpdate: (kind: 'LaborRate' | 'MachineRate', id: string, patch: Partial<RateRow>) => void; onDelete: (kind: 'LaborRate' | 'MachineRate', id: string) => void; sensors: ReturnType<typeof useSensors>; onDragEnd: (e: DragEndEvent) => void; onCreateRate: (input: { name: string; category: string; cost: number; markup: number }) => Promise<string | null> }) {
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [showAddForm, setShowAddForm] = useState(false)
  const [nameSearch, setNameSearch] = useState('')
  const [showNameResults, setShowNameResults] = useState(false)

  const addedIds = useMemo(() => new Set(rows.map((r: RateRow) => r.rate_id)), [rows])
  const ratesInCategory = useMemo(() => { if (!selectedCategory) return []; return rates.filter((r) => r.category === selectedCategory && !addedIds.has(r.id)) }, [selectedCategory, rates, addedIds])
  const nameSearchResults = useMemo(() => {
    if (nameSearch.length < 2) return []
    const q = nameSearch.toLowerCase()
    return rates.filter((r) => r.name.toLowerCase().includes(q) && !addedIds.has(r.id)).slice(0, 12)
  }, [nameSearch, rates, addedIds])

  function handleCategoryChange(value: string) { if (value === ADD_NEW) { setShowAddForm(true); setSelectedCategory(''); return }; setSelectedCategory(value); setCheckedIds(new Set()) }
  function toggleChecked(id: string) { setCheckedIds((prev: Set<string>) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  function handleAddSelected() { if (checkedIds.size === 0) return; onAddRates(Array.from(checkedIds)); setCheckedIds(new Set()); setSelectedCategory('') }
  function handleAddByName(id: string) { onAddRates([id]); setNameSearch(''); setShowNameResults(false) }

  return (
    <ColoredSection title={`${title} (${rows.length})`} borderColor={borderColor}>
      <div className="mb-3 space-y-3">
        {/* Method A: Add by Name */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Add by Name</label>
          <div className="relative">
            <input type="text" className={inputCls} placeholder={`Search ${title.toLowerCase()}...`} value={nameSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setNameSearch(e.target.value); setShowNameResults(true) }}
              onFocus={() => setShowNameResults(true)}
              onBlur={() => setTimeout(() => setShowNameResults(false), 200)}
            />
            {showNameResults && nameSearch.length >= 2 && (
              <div className="absolute top-full left-0 right-0 z-20 mt-0.5 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                {nameSearchResults.map((r: LaborRateOption | MachineRateOption) => (
                  <button key={r.id} type="button" onMouseDown={() => handleAddByName(r.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50">
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="text-xs text-gray-400 tabular-nums">${r.cost?.toFixed(2) ?? '0.00'}</span>
                    {r.category && <span className="text-[10px] text-gray-400 truncate max-w-[80px]">{r.category}</span>}
                  </button>
                ))}
                {nameSearchResults.length === 0 && <div className="px-3 py-2 text-xs text-gray-400 italic">No results for &ldquo;{nameSearch}&rdquo;</div>}
                <button type="button" onMouseDown={() => setShowAddForm(true)} className="flex w-full items-center gap-1.5 border-t border-gray-100 px-3 py-1.5 text-left text-xs font-semibold text-qm-lime-dark hover:bg-gray-50">
                  <PlusIcon />+ Add New {kind === 'LaborRate' ? 'Labor' : 'Machine'} Rate
                </button>
              </div>
            )}
          </div>
        </div>
        {/* Method B: Browse by Category */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Browse by Category</label>
          <select className={inputCls} value={selectedCategory} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleCategoryChange(e.target.value)}>
            <option value="">— Select category —</option>
            {rateCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={ADD_NEW}>+ Add New {kind === 'LaborRate' ? 'Labor' : 'Machine'} Rate</option>
          </select>
          {selectedCategory && ratesInCategory.length > 0 && (
            <div className="mt-1.5 rounded border border-gray-200 bg-gray-50 p-2 space-y-1">
              {ratesInCategory.map((r: LaborRateOption | MachineRateOption) => (
                <label key={r.id} className="flex items-center gap-2 text-sm hover:bg-white rounded px-1.5 py-0.5">
                  <input type="checkbox" checked={checkedIds.has(r.id)} onChange={() => toggleChecked(r.id)} className="accent-qm-lime h-4 w-4" />
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-gray-500 tabular-nums">${r.cost?.toFixed(2) ?? '0.00'}</span>
                </label>
              ))}
              <button type="button" onClick={handleAddSelected} disabled={checkedIds.size === 0} className="mt-1 w-full rounded bg-qm-lime px-2 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40">Add Selected ({checkedIds.size})</button>
            </div>
          )}
          {selectedCategory && ratesInCategory.length === 0 && <div className="mt-1 text-xs text-gray-400 italic">All {title.toLowerCase()} in this category are already added.</div>}
        </div>
        {showAddForm && <AddRateForm kind={kind} categories={rateCategories} onCancel={() => setShowAddForm(false)} onSubmit={async (input) => { const id = await onCreateRate(input); if (id) setShowAddForm(false) }} />}
      </div>
      <RateTable kind={kind} rows={rows} ratesById={ratesById} onUpdate={onUpdate} onDelete={onDelete} sensors={sensors} onDragEnd={onDragEnd} emptyText={`No ${title.toLowerCase()} yet. Use search or browse by category above.`} />
    </ColoredSection>
  )
}

function RateTable({ kind, rows, ratesById, onUpdate, onDelete, sensors, onDragEnd, emptyText }: { kind: 'LaborRate' | 'MachineRate'; rows: RateRow[]; ratesById: Map<string, LaborRateOption | MachineRateOption>; onUpdate: (kind: 'LaborRate' | 'MachineRate', id: string, patch: Partial<RateRow>) => void; onDelete: (kind: 'LaborRate' | 'MachineRate', id: string) => void; sensors: ReturnType<typeof useSensors>; onDragEnd: (e: DragEndEvent) => void; emptyText?: string }) {
  const GRID = 'grid grid-cols-[28px_24px_minmax(120px,1.5fr)_80px_60px_40px_minmax(120px,1.2fr)_28px] items-center gap-1.5 px-1.5 py-1.5'
  return (
    <div className="divide-y divide-gray-100 rounded border border-gray-100">
      <div className={`${GRID} bg-gray-50 text-[10px] font-medium uppercase tracking-wider text-gray-500 border-b`}>
        <span className="text-center" title="Show as workflow step">☑</span>
        <span className="text-center" title="Drag to reorder">⠿</span>
        <span>Name</span>
        <span>Formula</span>
        <span>Mult</span>
        <span className="text-center">Qty</span>
        <span>Modifier</span>
        <span className="text-center" title="Delete">✕</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-4 text-center text-xs text-gray-400 italic">{emptyText ?? 'No rates yet.'}</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            {rows.map((row: RateRow) => <SortableRateRow key={row.id} row={row} kind={kind} grid={GRID} ratesById={ratesById} onUpdate={onUpdate} onDelete={onDelete} />)}
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

function SortableRateRow({ row, kind, grid, ratesById, onUpdate, onDelete }: { row: RateRow; kind: 'LaborRate' | 'MachineRate'; grid: string; ratesById: Map<string, LaborRateOption | MachineRateOption>; onUpdate: (kind: 'LaborRate' | 'MachineRate', id: string, patch: Partial<RateRow>) => void; onDelete: (kind: 'LaborRate' | 'MachineRate', id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const name = ratesById.get(row.rate_id)?.name ?? 'Unknown'
  return (
    <div ref={setNodeRef} style={style} className={`${grid} border-b border-gray-100 hover:bg-gray-50`}>
      <label className="flex justify-center" title="Show as workflow step"><input type="checkbox" checked={row.workflow_step} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(kind, row.id, { workflow_step: e.target.checked })} className="accent-purple-600 h-4 w-4" /></label>
      <button {...attributes} {...listeners} type="button" className="cursor-grab text-gray-300 hover:text-gray-500 p-0.5 justify-self-center" title="Drag to reorder"><GripIcon /></button>
      <span className="text-xs font-medium text-gray-800 truncate" title={name}>{name}</span>
      <select className="h-7 rounded border border-gray-200 px-1 text-xs" value={row.formula ?? ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onUpdate(kind, row.id, { formula: e.target.value || null })}>
        <option value="">—</option>{FORMULA_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <input type="number" step="0.01" className="h-7 rounded border border-gray-200 px-1 text-xs tabular-nums" value={Number.isFinite(row.multiplier) ? row.multiplier : 1} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(kind, row.id, { multiplier: parseFloat(e.target.value) || 0 })} />
      <label className="flex justify-center"><input type="checkbox" checked={row.charge_per_li_unit} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(kind, row.id, { charge_per_li_unit: e.target.checked })} className="accent-purple-600 h-4 w-4" /></label>
      <input type="text" className="h-7 rounded border border-gray-200 px-1.5 text-xs font-mono" placeholder="Name or ((A)+(B))" value={row.modifier_formula ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(kind, row.id, { modifier_formula: e.target.value || null })} title="Modifier name or custom formula expression" />
      <button onClick={() => onDelete(kind, row.id)} className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600" title="Remove"><TrashIcon /></button>
    </div>
  )
}

function SortableModifierRow({ row, onUpdate, onDelete }: { row: ModifierRow; onUpdate: (id: string, patch: Partial<MigrateModifier>) => void; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-md border border-gray-100 bg-white px-2 py-1.5">
      <button {...attributes} {...listeners} type="button" className="cursor-grab text-gray-300 hover:text-gray-500 p-0.5" title="Drag to reorder"><GripIcon /></button>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.modifier_type === 'Boolean' ? 'bg-blue-100 text-blue-700' : row.modifier_type === 'Numeric' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>{row.modifier_type}</span>
      <span className="text-sm font-medium text-gray-800 truncate flex-1">{row.display_name}</span>
      <input type="text" className="h-7 w-28 rounded border border-gray-200 px-1.5 text-xs" placeholder="Default" value={row.default_value ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(row.id, { default_value: e.target.value || null })} />
      <label className="flex items-center gap-1 text-[11px] text-gray-500"><input type="checkbox" checked={row.is_required} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(row.id, { is_required: e.target.checked })} className="accent-purple-600" />required</label>
      <button onClick={() => onDelete(row.id)} className="rounded p-1 text-red-500 hover:bg-red-50" title="Remove"><XIcon /></button>
    </div>
  )
}

// ============================================================
// Inline forms
// ============================================================

function AddCategoryForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState('')
  return (<form onSubmit={(e: React.FormEvent) => { e.preventDefault(); onSubmit(name) }} className="bg-gray-50 border border-dashed border-gray-300 rounded p-3 space-y-2"><input className={inputCls} placeholder="Category name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} autoFocus /><div className="flex gap-2"><button type="submit" className="rounded bg-qm-lime px-3 py-1 text-xs font-semibold text-white">Save</button><button type="button" onClick={onCancel} className="rounded border border-gray-300 bg-white px-3 py-1 text-xs">Cancel</button></div></form>)
}
function AddWorkflowForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState('')
  return (<form onSubmit={(e: React.FormEvent) => { e.preventDefault(); onSubmit(name) }} className="bg-gray-50 border border-dashed border-gray-300 rounded p-3 mt-2 space-y-2"><input className={inputCls} placeholder="Workflow name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} autoFocus /><div className="flex gap-2"><button type="submit" className="rounded bg-qm-lime px-3 py-1 text-xs font-semibold text-white">Save</button><button type="button" onClick={onCancel} className="rounded border border-gray-300 bg-white px-3 py-1 text-xs">Cancel</button></div></form>)
}
function AddDiscountForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (name: string, type: 'Range' | 'Volume' | 'Price') => void }) {
  const [name, setName] = useState(''); const [type, setType] = useState<'Range' | 'Volume' | 'Price'>('Range')
  return (<form onSubmit={(e: React.FormEvent) => { e.preventDefault(); onSubmit(name, type) }} className="bg-gray-50 border border-dashed border-gray-300 rounded p-3 mt-2 space-y-2"><input className={inputCls} placeholder="Discount name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} autoFocus /><select className={inputCls} value={type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setType(e.target.value as 'Range' | 'Volume' | 'Price')}><option value="Range">Range</option><option value="Volume">Volume</option><option value="Price">Price</option></select><div className="flex gap-2"><button type="submit" className="rounded bg-qm-lime px-3 py-1 text-xs font-semibold text-white">Save</button><button type="button" onClick={onCancel} className="rounded border border-gray-300 bg-white px-3 py-1 text-xs">Cancel</button></div></form>)
}
function AddModifierForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (name: string, type: 'Boolean' | 'Numeric' | 'Range', def: string | null) => void }) {
  const [name, setName] = useState(''); const [type, setType] = useState<'Boolean' | 'Numeric' | 'Range'>('Boolean'); const [def, setDef] = useState('')
  return (<form onSubmit={(e: React.FormEvent) => { e.preventDefault(); onSubmit(name, type, def || null) }} className="bg-gray-50 border border-dashed border-gray-300 rounded p-3 mt-2 space-y-2"><input className={inputCls} placeholder="Modifier name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} autoFocus /><div className="grid grid-cols-2 gap-2"><select className={inputCls} value={type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setType(e.target.value as 'Boolean' | 'Numeric' | 'Range')}><option value="Boolean">Boolean</option><option value="Numeric">Numeric</option><option value="Range">Range</option></select><input className={inputCls} placeholder="Default value" value={def} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDef(e.target.value)} /></div><div className="flex gap-2"><button type="submit" className="rounded bg-qm-lime px-3 py-1 text-xs font-semibold text-white">Save</button><button type="button" onClick={onCancel} className="rounded border border-gray-300 bg-white px-3 py-1 text-xs">Cancel</button></div></form>)
}
function AddRateForm({ kind, categories, onCancel, onSubmit }: { kind: 'LaborRate' | 'MachineRate'; categories: string[]; onCancel: () => void; onSubmit: (input: { name: string; category: string; cost: number; markup: number }) => void }) {
  const [name, setName] = useState(''); const [category, setCategory] = useState(''); const [cost, setCost] = useState('0'); const [markup, setMarkup] = useState('1')
  return (<form onSubmit={(e: React.FormEvent) => { e.preventDefault(); onSubmit({ name, category, cost: parseFloat(cost) || 0, markup: parseFloat(markup) || 1 }) }} className="bg-gray-50 border border-dashed border-gray-300 rounded p-3 mt-2 space-y-2"><input className={inputCls} placeholder={`${kind === 'LaborRate' ? 'Labor' : 'Machine'} rate name`} value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} autoFocus /><input className={inputCls} placeholder="Category" value={category} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCategory(e.target.value)} list={`rate-cat-${kind}`} /><datalist id={`rate-cat-${kind}`}>{categories.map((c) => <option key={c} value={c} />)}</datalist><div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-gray-500">Cost ($)<input className={inputCls} type="number" step="0.01" value={cost} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCost(e.target.value)} /></label><label className="text-[11px] text-gray-500">Markup (x)<input className={inputCls} type="number" step="0.01" value={markup} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMarkup(e.target.value)} /></label></div><div className="flex gap-2"><button type="submit" className="rounded bg-qm-lime px-3 py-1 text-xs font-semibold text-white">Save</button><button type="button" onClick={onCancel} className="rounded border border-gray-300 bg-white px-3 py-1 text-xs">Cancel</button></div></form>)
}

// ============================================================
// SelectWithAdd
// ============================================================

function SelectWithAdd({ value, onChange, options, placeholder, addLabel, renderAddForm }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; addLabel: string; renderAddForm: (close: () => void) => React.ReactNode }) {
  const [showForm, setShowForm] = useState(false)
  return (<><select className={inputCls} value={value} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { if (e.target.value === ADD_NEW) { setShowForm(true); return }; onChange(e.target.value) }}><option value="">{placeholder ?? '— None —'}</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}<option value={ADD_NEW}>{addLabel}</option></select>{showForm && renderAddForm(() => setShowForm(false))}</>)
}

// ============================================================
// Section shells
// ============================================================

function SectionHeaderLeft() { return (<div className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 border border-gray-200"><LockIcon /><h2 className="text-sm font-bold uppercase tracking-wider text-gray-600">ShopVOX Reference</h2><span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wider">Read-only</span></div>) }
function SectionHeaderRight() { return (<div className="flex items-center gap-2 rounded-lg bg-qm-lime-light border border-qm-lime px-4 py-2.5"><EditIcon /><h2 className="text-sm font-bold uppercase tracking-wider text-qm-lime-dark">PrintOS Builder</h2><span className="ml-auto text-[10px] text-qm-lime-dark/70 uppercase tracking-wider">Editable</span></div>) }

function LeftSection({ title, children, onCopyAll, canCopy }: { title: string; children: React.ReactNode; onCopyAll: () => void; canCopy: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-[#f8f8f8]">
      <div className="flex items-center justify-between bg-gray-50 border-b border-gray-200 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</h3>
        {canCopy && <button onClick={onCopyAll} className="inline-flex items-center gap-1 rounded-md bg-white border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-qm-lime-light hover:border-qm-lime hover:text-qm-lime-dark">Copy All <ArrowRightIcon /></button>}
      </div>
      <div className="p-2 space-y-1">{children}</div>
    </div>
  )
}

// FIX 1: Every left panel row has a checkbox
function LeftCheckRow({ rowKey, reviewed, onToggle, onCopy, children }: { rowKey: string; reviewed: boolean; onToggle: () => void; onCopy?: () => void; children: React.ReactNode }) {
  return (
    <div className={`group flex items-start gap-1.5 rounded-md border bg-white px-2 py-1.5 transition-all ${reviewed ? 'border-gray-100 opacity-60' : 'border-transparent hover:border-qm-lime hover:shadow-sm'}`}>
      <input type="checkbox" checked={reviewed} onChange={onToggle} className="mt-0.5 accent-qm-lime h-3.5 w-3.5 shrink-0" title="Mark reviewed" />
      <div className={`flex-1 min-w-0 transition-all ${reviewed ? 'line-through text-gray-400' : ''}`}>{children}</div>
      {onCopy && <button onClick={onCopy} className="shrink-0 rounded p-1 text-gray-400 hover:bg-qm-lime hover:text-white transition-colors opacity-0 group-hover:opacity-100" title="Copy to PrintOS"><ArrowRightIcon /></button>}
    </div>
  )
}

function KV({ k, v }: { k: string; v: string | null | undefined }) {
  return (<div className="flex items-center gap-2"><span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 w-32 shrink-0">{k}</span><span className="text-sm text-gray-800 truncate">{v ?? '—'}</span></div>)
}
function RightSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (<div className="rounded-lg border border-gray-200 bg-white"><div className="flex items-center justify-between border-b border-gray-100 px-3 py-2"><h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h3>{action}</div><div className="p-3 space-y-2">{children}</div></div>)
}
// FIX 5: Colored left border for all right panel sections
function ColoredSection({ title, borderColor, action, children }: { title: string; borderColor: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (<div className={`rounded-lg border border-gray-200 bg-white border-l-4 ${borderColor}`}><div className="flex items-center justify-between border-b border-gray-100 pl-3 pr-3 py-2"><h3 className="font-semibold text-sm uppercase tracking-wide text-gray-700">{title}</h3>{action}</div><div className="p-2">{children}</div></div>)
}
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{label}</label>{children}</div>)
}
function AddBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (<button onClick={onClick} className="inline-flex items-center gap-1 rounded-md bg-qm-lime px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-110"><PlusIcon />{children}</button>)
}
function EmptyState({ text }: { text: string }) {
  return (<div className="rounded-md border border-dashed border-gray-200 py-5 text-center text-xs text-gray-400">{text}</div>)
}

// ============================================================
// Icons + shared CSS
// ============================================================

const inputCls = 'block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function TypeBadge({ kind }: { kind: 'Material' | 'LaborRate' | 'MachineRate' | 'CustomItem' }) {
  const s = kind === 'Material' ? 'bg-emerald-100 text-emerald-700' : kind === 'LaborRate' ? 'bg-sky-100 text-sky-700' : kind === 'MachineRate' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'
  const label = kind === 'LaborRate' ? 'Labor' : kind === 'MachineRate' ? 'Machine' : kind === 'CustomItem' ? 'Custom' : 'Material'
  return (<span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${s}`}>{label}</span>)
}
function ArrowRightIcon() { return (<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" /></svg>) }
function LockIcon() { return (<svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>) }
function EditIcon() { return (<svg className="h-4 w-4 text-qm-lime-dark" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487 18.549 2.8a2.121 2.121 0 1 1 3 3L19.862 7.487m-3-3L6.75 14.6V18h3.4l10.112-10.113m-3-3L12 8.25" /></svg>) }
function XIcon() { return (<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>) }
function PlusIcon() { return (<svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.4} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>) }
function GripIcon() { return (<svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M7 4a1 1 0 110 2 1 1 0 010-2zM7 9a1 1 0 110 2 1 1 0 010-2zM7 14a1 1 0 110 2 1 1 0 010-2zM13 4a1 1 0 110 2 1 1 0 010-2zM13 9a1 1 0 110 2 1 1 0 010-2zM13 14a1 1 0 110 2 1 1 0 010-2z" /></svg>) }
function TrashIcon() { return (<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>) }

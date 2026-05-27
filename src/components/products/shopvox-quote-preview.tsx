'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { computeLineItem, computeMaterialLineItem, type RateRecord } from '@/lib/pricing/compute-line-item'
import { fetchMaterialsForQuote } from '@/app/(dashboard)/dashboard/[slug]/products/[id]/migrate/actions'

interface Props {
  shopvoxData: any
  productName: string
  orgSlug: string
}

type RateRow = {
  name: string
  cost: number
  price: number
  markup: number
  production_rate: number | null
  setup_charge: number | null
  other_charge: number | null
}
type RateMap = Record<string, RateRow>

type FullMaterialRow = {
  name: string
  cost: number
  price: number
  formula: string | null
  fixed_side: string | null
  width: number | null
  height: number | null
  wastage_markup: number | null
  calculate_wastage: boolean | null
  material_category: string | null
}
type FullMaterialMap = Record<string, FullMaterialRow>

interface LineResult {
  name: string
  itemType: string
  formula: string
  displayQty: number
  unitCost: number
  unitPrice: number
  totalCost: number
  totalPrice: number
  active: boolean
  rateFound: boolean
  isMaterial: boolean
  breakdown?: string[]
}

function fmt(n: number) {
  return '$' + n.toFixed(2)
}

function computeFormula(formula: string, widthFt: number, heightFt: number): number {
  const f = (formula ?? '').toLowerCase().trim()
  if (f === 'area' || f.includes('area')) return widthFt * heightFt
  if (f === 'perimeter' || f.includes('perim')) return 2 * (widthFt + heightFt)
  if (f === 'height') return heightFt
  if (f === 'width') return widthFt
  return 1
}

function buildRateMap(rows: any[]): RateMap {
  const m: RateMap = {}
  for (const r of rows ?? []) {
    if (r?.name) {
      m[r.name.trim().toLowerCase()] = {
        name: r.name,
        cost: r.cost ?? 0,
        price: r.price ?? (r.cost ?? 0) * (r.markup ?? 1),
        markup: r.markup ?? 1,
        production_rate: r.production_rate ?? null,
        setup_charge: r.setup_charge ?? null,
        other_charge: r.other_charge ?? null,
      }
    }
  }
  return m
}

function normalize(s: string) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findMaterial(map: FullMaterialMap, name: string): FullMaterialRow | undefined {
  return map[name.trim().toLowerCase()]
}

// Safe formula evaluator: replaces modifier variable names with their current values
// then evaluates the expression string. Handles ternary, arithmetic, boolean.
// e.g. "Grommets_Corners ? 4 : No_Grommets ? 0 : (2*(Width+Height))/Grommets_Spacing"
function evalExpression(expr: string, vars: Record<string, any>): number {
  let s = expr
  // Sort longer names first to avoid partial replacements (e.g. "Width" before "W")
  const names = Object.keys(vars).sort((a, b) => b.length - a.length)
  for (const name of names) {
    const v = vars[name]
    const replacement = typeof v === 'boolean' ? String(v) : String(parseFloat(String(v)) || 0)
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    s = s.replace(new RegExp('(?<![A-Za-z0-9_])' + escaped + '(?![A-Za-z0-9_])', 'g'), replacement)
  }
  // Replace any remaining unsubstituted identifiers with 0 — prevents ReferenceError in ternaries
  // when a variable like Grommets_Spacing is blank/0 and not present in vars
  s = s.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m) =>
    /^(true|false|null|undefined|Infinity|NaN)$/.test(m) ? m : '0'
  )
  try {
    // eslint-disable-next-line no-new-func
    const r = new Function(`"use strict"; return (${s})`)()
    return typeof r === 'number' && isFinite(r) ? r : 0
  } catch (err) {
    console.error('[evalExpression] failed on:', s, err)
    return 0
  }
}

function TypeBadge({ type }: { type: string }) {
  const t = (type ?? '').toLowerCase().replace('_', '')
  if (t === 'material')
    return <span className="inline-flex rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium">Material</span>
  if (t === 'laborrate' || t === 'labor')
    return <span className="inline-flex rounded-full bg-purple-100 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">Labor</span>
  if (t === 'machinerate' || t === 'machine')
    return <span className="inline-flex rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 text-[10px] font-medium">Machine</span>
  return <span className="text-[10px] text-gray-500">{type}</span>
}

export default function ShopvoxQuotePreview({ shopvoxData, productName, orgSlug }: Props) {
  const modifiers: any[] = shopvoxData?.modifiers ?? []
  const dropdownMenus: any[] = shopvoxData?.dropdown_menus ?? []
  const defaultItems: any[] = shopvoxData?.default_items ?? []

  // ── state ─────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [width] = useState(48)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [height] = useState(96)
  const [qty, setQty] = useState(1)
  const [modVals, setModVals] = useState<Record<string, any>>({})
  const [dropdownVals, setDropdownVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const dm of (shopvoxData?.dropdown_menus ?? [])) {
      const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
      const items: string[] = dm?.selected_items ?? []
      if (menuName) {
        init[menuName] = (dm?.optional || menuName.toLowerCase().includes('optional')) ? '' : (items[0] ?? '')
      }
    }
    return init
  })

  const [ratesLoading, setRatesLoading] = useState(true)
  const [ratesError, setRatesError] = useState<string | null>(null)
  const [ratesReady, setRatesReady] = useState(false)
  const [laborMap, setLaborMap] = useState<RateMap>({})
  const [machineMap, setMachineMap] = useState<RateMap>({})
  const [fullMaterialMap, setFullMaterialMap] = useState<FullMaterialMap>({})
  const fullMaterialMapRef = useRef<FullMaterialMap>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [materialsLoading, setMaterialsLoading] = useState(true)

  const [results, setResults] = useState<LineResult[] | null>(null)
  const [grandTotalCost, setGrandTotalCost] = useState(0)
  const [grandTotalPrice, setGrandTotalPrice] = useState(0)

  // ── initialize modifier defaults ──────────────────────────────
  useEffect(() => {
    const init: Record<string, any> = {}
    for (const m of modifiers) {
      const name = m?.name ?? m?.Name ?? ''
      if (!name) continue
      const type = (m?.type ?? m?.Type ?? '').toLowerCase()
      const defVal = m?.defaultValue ?? m?.DefaultValue ?? m?.default_value ?? m?.default ?? ''
      if (type === 'boolean' || type === 'checkbox') {
        init[name] = defVal === 'true' || defVal === 'on' || defVal === true
      } else {
        const parsed = parseFloat(String(defVal))
        init[name] = isNaN(parsed) ? 0 : parsed
      }
    }
    if (init['Height'] === undefined) init['Height'] = 96
    if (init['Width'] === undefined) init['Width'] = 48
    setModVals(init)
  }, [shopvoxData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── init dropdowns when shopvoxData loads asynchronously ─────
  useEffect(() => {
    if (!shopvoxData?.dropdown_menus?.length) return
    const init: Record<string, string> = {}
    for (const dm of (shopvoxData.dropdown_menus as any[])) {
      const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
      const selectedItems: string[] = dm?.selected_items ?? []
      const allItems: string[] = selectedItems.length > 0 ? selectedItems : (dm?.items ?? dm?.all_items ?? [])
      if (menuName) {
        const isOptional = !!dm?.optional || menuName.toLowerCase().includes('optional')
        init[menuName] = isOptional ? '' : (allItems[0] ?? '')
      }
    }
    setDropdownVals(init)
  }, [shopvoxData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── fetch rates on mount ──────────────────────────────────────
  useEffect(() => {
    if (!orgSlug) return
    let cancelled = false
    async function load() {
      setRatesLoading(true)
      setRatesError(null)
      try {
        const supabase = createClient()
        const { data: orgRow, error: orgErr } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', orgSlug)
          .limit(1)
          .maybeSingle()
        if (orgErr || !orgRow) throw new Error('Organization not found')
        const orgId = (orgRow as { id: string }).id

        const [laborRes, machineRes, matRows] = await Promise.all([
          supabase.from('labor_rates').select('name, cost, price, markup, production_rate, setup_charge, other_charge').eq('organization_id', orgId).eq('active', true),
          supabase.from('machine_rates').select('name, cost, price, markup, production_rate, setup_charge, other_charge').eq('organization_id', orgId).eq('active', true),
          fetchMaterialsForQuote(orgId),
        ])

        if (!cancelled) {
          setLaborMap(buildRateMap(laborRes.data ?? []))
          setMachineMap(buildRateMap(machineRes.data ?? []))
          const matData: FullMaterialMap = {}
          for (const r of matRows as any[]) {
            if (r?.name) matData[r.name.trim().toLowerCase()] = {
              name: r.name, cost: r.cost ?? 0,
              price: r.price ?? (r.cost ?? 0) * (r.markup ?? 1),
              formula: r.formula ?? null, fixed_side: r.fixed_side ?? null,
              width: r.width ?? null, height: r.height ?? null,
              wastage_markup: r.wastage_markup ?? null, calculate_wastage: r.calculate_wastage ?? null,
              material_category: r.material_category ?? null,
            }
          }
          setFullMaterialMap(matData)
          fullMaterialMapRef.current = matData
          setMaterialsLoading(false)
          setRatesReady(true)
        }
      } catch (e) {
        if (!cancelled) setRatesError(e instanceof Error ? e.message : 'Failed to load rates')
      } finally {
        if (!cancelled) setRatesLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [orgSlug])

  // ── calculate ─────────────────────────────────────────────────
  function handleCalculate() {
    if (!ratesReady) return

    const widthInches  = parseFloat(String(modVals['Width']  ?? modVals['width']  ?? 48)) || 48
    const heightInches = parseFloat(String(modVals['Height'] ?? modVals['height'] ?? 96)) || 96
    const widthFt  = widthInches / 12
    const heightFt = heightInches / 12
    const q = Math.max(1, qty)

    const lines: LineResult[] = []

    for (const d of defaultItems) {
      const name = d?.name ?? d?.Name ?? ''
      const rawType = d?.item_type ?? d?.['Item Type'] ?? d?.ItemType ?? d?.type ?? ''
      const itemFormula = d?.formula ?? d?.Formula ?? 'Unit'
      const multiplier = parseFloat(String(d?.multiplier ?? d?.Multiplier ?? '1')) || 1
      const attachNum: string = d?.attach_num_modifier ?? d?.num_modifier ?? ''
      const attachChk: string = d?.attach_chk_modifier ?? d?.chk_modifier ?? ''

      let active = true
      let numModFactor = 1

      if (attachChk) {
        active = modVals[attachChk] === true
      } else if (attachNum) {
        const cleanNum = attachNum.trim().replace(/;+$/, '')
        const exprVars: Record<string, any> = {}
        for (const [k, v] of Object.entries({ ...modVals, Width: widthInches, Height: heightInches })) {
          exprVars[k.trim()] = v
        }
        const numVal = evalExpression(cleanNum, exprVars)
        if (!isFinite(numVal) || numVal <= 0) {
          active = false
        } else {
          numModFactor = numVal
        }
      } else {
        const isDropdownControlled = dropdownMenus.some(dm => {
          if ((dm?.item_type ?? '').toLowerCase() === 'material') return false
          const opts: string[] = dm?.selected_items ?? dm?.items ?? dm?.all_items ?? []
          return opts.some(opt => {
            const optName = (typeof opt === 'string' ? opt : (opt as any).name ?? '').trim().toLowerCase()
            const itemName = name.trim().toLowerCase()
            return optName === itemName
          })
        })
        if (isDropdownControlled) {
          active = Object.values(dropdownVals).some(val => {
            return (val ?? '').trim().toLowerCase() === name.trim().toLowerCase()
          })
        }
      }

      const perLiUnit: boolean = !!(d?.per_li_unit ?? d?.per_li ?? false)
      const typeLower = rawType.toLowerCase().replace('_', '')
      const isMat = typeLower === 'material'

      let totalCost = 0
      let totalPrice = 0
      let displayQty = 0
      let rateFound = false
      let breakdown: string[] | undefined

      if (isMat) {
        const mat = findMaterial(fullMaterialMapRef.current, name)
        rateFound = !!mat
        if (active && mat) {
          const res = computeMaterialLineItem(
            { cost: mat.cost, formula: mat.formula ?? itemFormula, fixed_side: mat.fixed_side, width: mat.width, height: mat.height, wastage_markup: mat.wastage_markup, calculate_wastage: mat.calculate_wastage },
            widthInches, heightInches, q, multiplier * numModFactor, perLiUnit,
          )
          totalCost = res.lineTotal
          totalPrice = mat.price > 0 && mat.cost > 0 ? res.lineTotal * (mat.price / mat.cost) : res.lineTotal
          displayQty = parseFloat(res.finalQty.toFixed(4))
          const bk: string[] = [`Print area: ${res.printArea.toFixed(2)} sqft × ${fmt(mat.cost)} = ${fmt(res.printArea * mat.cost)}`]
          if (res.wasteArea > 0) {
            bk.push(`Waste (${res.wasteStripInches.toFixed(0)}in strip): ${res.wasteArea.toFixed(2)} sqft × ${fmt(mat.cost)} × ${res.wastageMarkupPct}% = ${fmt(res.chargeableWaste * mat.cost)}`)
          }
          breakdown = bk
        } else {
          displayQty = multiplier * numModFactor * (perLiUnit ? q : 1)
        }
        lines.push({ name, itemType: rawType, formula: itemFormula, displayQty, unitCost: mat?.cost ?? 0, unitPrice: mat?.price ?? 0, totalCost, totalPrice, active, rateFound, isMaterial: true, breakdown })
      } else {
        const perPiece = computeFormula(itemFormula, widthFt, heightFt)
        const perPieceFormQty = perPiece * multiplier * numModFactor
        displayQty = active ? perPieceFormQty * q : perPiece * multiplier * q
        const rateMap =
          typeLower === 'laborrate' || typeLower === 'labor' ? laborMap
          : typeLower === 'machinerate' || typeLower === 'machine' ? machineMap
          : laborMap
        const rate = rateMap[name.trim().toLowerCase()]
        rateFound = !!rate
        if (active && rate) {
          const rateRec: RateRecord = {
            name: rate.name, cost: rate.cost, price: rate.price, markup: rate.markup,
            production_rate: rate.production_rate ?? undefined,
            setup_charge: rate.setup_charge ?? undefined,
            other_charge: rate.other_charge ?? undefined,
          }
          const result = computeLineItem(rateRec, perPieceFormQty, q)
          totalCost = result.totalCost
          totalPrice = result.totalPrice
          displayQty = result.displayQty * q
        }
        lines.push({ name, itemType: rawType, formula: itemFormula, displayQty, unitCost: rate?.cost ?? 0, unitPrice: rate?.price ?? 0, totalCost, totalPrice, active, rateFound, isMaterial: false })
      }
    }

    // Price materials selected from dropdown menus (e.g. banner roll)
    for (const dm of dropdownMenus) {
      const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
      if ((dm?.item_type ?? '').toLowerCase() !== 'material') continue
      const selectedVal = dropdownVals[menuName] ?? ''
      if (!selectedVal) continue

      const dmAttachNum: string = (dm?.attach_num_modifier ?? '').trim()
      const dmAttachNumQty: number = dmAttachNum ? (parseFloat(String(modVals[dmAttachNum] ?? 0)) || 0) : 0
      const hasDmAttachNum = !!dmAttachNum

      if (hasDmAttachNum && dmAttachNumQty <= 0) {
        lines.push({ name: selectedVal, itemType: 'Material', formula: 'Unit', displayQty: 0, unitCost: 0, unitPrice: 0, totalCost: 0, totalPrice: 0, active: false, rateFound: true, isMaterial: true })
        continue
      }

      const mat = findMaterial(fullMaterialMapRef.current, selectedVal)
      if (!mat) {
        lines.push({ name: selectedVal, itemType: 'Material', formula: 'Area', displayQty: 0, unitCost: 0, unitPrice: 0, totalCost: 0, totalPrice: 0, active: true, rateFound: false, isMaterial: true })
        continue
      }

      if (hasDmAttachNum) {
        lines.push({ name: selectedVal, itemType: 'Material', formula: 'Unit', displayQty: dmAttachNumQty, unitCost: mat.cost, unitPrice: mat.price, totalCost: dmAttachNumQty * mat.cost, totalPrice: dmAttachNumQty * mat.price, active: true, rateFound: true, isMaterial: true })
      } else {
        const res = computeMaterialLineItem(
          { cost: mat.cost, formula: mat.formula ?? 'Area', fixed_side: mat.fixed_side, width: mat.width, height: mat.height, wastage_markup: mat.wastage_markup, calculate_wastage: mat.calculate_wastage },
          widthInches, heightInches, q, 1, true,
        )
        const dTotalCost = res.lineTotal
        const dTotalPrice = mat.price > 0 && mat.cost > 0 ? res.lineTotal * (mat.price / mat.cost) : res.lineTotal
        const bk: string[] = [`Print area: ${res.printArea.toFixed(2)} sqft × ${fmt(mat.cost)} = ${fmt(res.printArea * mat.cost)}`]
        if (res.wasteArea > 0) {
          bk.push(`Waste (${res.wasteStripInches.toFixed(0)}in strip): ${res.wasteArea.toFixed(2)} sqft × ${fmt(mat.cost)} × ${res.wastageMarkupPct}% = ${fmt(res.chargeableWaste * mat.cost)}`)
        }
        lines.push({ name: selectedVal, itemType: 'Material', formula: mat.formula ?? 'Area', displayQty: parseFloat(res.finalQty.toFixed(4)), unitCost: mat.cost, unitPrice: mat.price, totalCost: dTotalCost, totalPrice: dTotalPrice, active: true, rateFound: true, isMaterial: true, breakdown: bk })
      }
    }

    // Price machine rate and labor rate dropdowns (e.g. Hemming, Pole Pocket)
    for (const dm of dropdownMenus) {
      const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
      const dmTypeLower = (dm?.item_type ?? '').toLowerCase().replace('_', '')
      if (dmTypeLower !== 'machinerate' && dmTypeLower !== 'machine' && dmTypeLower !== 'laborrate' && dmTypeLower !== 'labor') continue
      const selectedVal = dropdownVals[menuName] ?? ''
      if (!selectedVal) continue

      const dmAttachNum: string = (dm?.attach_num_modifier ?? '').trim()
      const dmAttachNumQty: number = dmAttachNum ? (parseFloat(String(modVals[dmAttachNum] ?? 0)) || 0) : 0
      const hasDmAttachNum = !!dmAttachNum

      if (hasDmAttachNum && dmAttachNumQty <= 0) {
        lines.push({ name: selectedVal, itemType: dm?.item_type ?? 'MachineRate', formula: 'Unit', displayQty: 0, unitCost: 0, unitPrice: 0, totalCost: 0, totalPrice: 0, active: false, rateFound: true, isMaterial: false })
        continue
      }

      const rateMap = (dmTypeLower === 'machinerate' || dmTypeLower === 'machine') ? machineMap : laborMap
      const rate = rateMap[selectedVal.trim().toLowerCase()]
      if (!rate) {
        lines.push({ name: selectedVal, itemType: dm?.item_type ?? 'MachineRate', formula: 'Unit', displayQty: 0, unitCost: 0, unitPrice: 0, totalCost: 0, totalPrice: 0, active: true, rateFound: false, isMaterial: false })
        continue
      }
      const rateRec: RateRecord = {
        name: rate.name, cost: rate.cost, price: rate.price, markup: rate.markup,
        production_rate: rate.production_rate ?? undefined,
        setup_charge: rate.setup_charge ?? undefined,
        other_charge: rate.other_charge ?? undefined,
      }

      if (hasDmAttachNum) {
        lines.push({ name: selectedVal, itemType: dm?.item_type ?? 'MachineRate', formula: 'Unit', displayQty: dmAttachNumQty, unitCost: rate.cost, unitPrice: rate.price, totalCost: dmAttachNumQty * rate.cost, totalPrice: dmAttachNumQty * rate.price, active: true, rateFound: true, isMaterial: false })
      } else {
        const result = computeLineItem(rateRec, 1, q)
        lines.push({ name: selectedVal, itemType: dm?.item_type ?? 'MachineRate', formula: 'Unit', displayQty: result.displayQty * q, unitCost: rate.cost, unitPrice: rate.price, totalCost: result.totalCost, totalPrice: result.totalPrice, active: true, rateFound: true, isMaterial: false })
      }
    }

    const gCost = lines.reduce((s, l) => s + l.totalCost, 0)
    const gPrice = lines.reduce((s, l) => s + l.totalPrice, 0)
    setResults(lines)
    setGrandTotalCost(gCost)
    setGrandTotalPrice(gPrice)
  }

  // ── auto-recalculate with debounce ────────────────────────────
  useEffect(() => {
    if (!ratesReady) return
    if (!((modVals['Width'] ?? 0) > 0 || (modVals['Height'] ?? 0) > 0)) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(handleCalculate, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [modVals, dropdownVals, ratesReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── guard clauses ─────────────────────────────────────────────
  if (!shopvoxData) {
    return (
      <div className="text-xs text-gray-400 italic py-6 text-center">
        No ShopVOX data available.
      </div>
    )
  }
  if (defaultItems.length === 0) {
    return (
      <div className="text-xs text-gray-400 italic py-6 text-center">
        No default items found in ShopVOX data.
      </div>
    )
  }

  const overallMargin =
    grandTotalPrice > 0 ? ((grandTotalPrice - grandTotalCost) / grandTotalPrice) * 100 : 0

  const boolMods = modifiers.filter(m => {
    const t = (m?.type ?? m?.Type ?? '').toLowerCase()
    return t === 'boolean' || t === 'checkbox'
  })
  const nonBoolMods = modifiers.filter(m => {
    const t = (m?.type ?? m?.Type ?? '').toLowerCase()
    return t !== 'boolean' && t !== 'checkbox'
  })

  return (
    <div className="space-y-3 text-xs overflow-x-hidden">
      {/* 1. Header */}
      <div>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
          ShopVOX Reference Pricing
        </p>
        <p className="text-[10px] text-gray-400 italic">
          Compare this to the PrintOS Builder on the right →
        </p>
      </div>

      {/* Rates status */}
      {ratesLoading && (
        <div className="flex items-center gap-2 text-gray-400 py-1">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent" />
          Loading rates…
        </div>
      )}
      {ratesError && <p className="text-red-500">{ratesError}</p>}

      {/* 2. QTY input */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-500 font-medium">QTY</span>
        <input type="number" min={1} value={qty}
          onChange={e => setQty(parseInt(e.target.value)||1)}
          className="w-16 border border-gray-300 rounded px-1.5 py-1 text-xs" />
      </div>

      {/* 3. Modifiers (numeric grid) */}
      {nonBoolMods.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Modifiers</p>
          <div className="grid grid-cols-3 gap-2">
            {nonBoolMods.map((m, i) => {
              const name = m?.name ?? m?.Name ?? ''
              const type = (m?.type ?? m?.Type ?? '').toLowerCase()
              const isNumeric = type === 'numeric' || type === 'number'
              return (
                <div key={i}>
                  <label className="block truncate text-[10px] text-gray-500 mb-0.5" title={name}>{name}</label>
                  {isNumeric ? (
                    <input type="number" min={0} step="any"
                      value={modVals[name] === 0 ? '' : (modVals[name] ?? '')}
                      onChange={e => {
                        const parsed = parseFloat(e.target.value)
                        setModVals(p => ({ ...p, [name]: isNaN(parsed) ? 0 : parsed }))
                      }}
                      className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs" />
                  ) : (
                    <input type="text"
                      value={String(modVals[name] ?? '')}
                      onChange={e => setModVals(p => ({ ...p, [name]: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. Options (boolean checkboxes) */}
      {boolMods.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Options</p>
          {boolMods.map((m, i) => {
            const name = m?.name ?? m?.Name ?? ''
            const isOpt = m?.optional === true || m?.optional === 'true'
            return (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={!!modVals[name]}
                  onChange={e => setModVals(p => ({ ...p, [name]: e.target.checked }))}
                  className="h-3 w-3 accent-green-500" />
                <label className="text-xs text-gray-700">{name}</label>
                {isOpt && <span className="text-[10px] text-gray-400">(optional)</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* 5. Dropdown Selections */}
      {dropdownMenus.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Dropdown Selections</p>
          {dropdownMenus.map((dm, i) => {
            const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
            const selectedItems: string[] = dm?.selected_items ?? []
            const dmCategory: string | undefined = dm?.category
            const items: string[] = selectedItems.length > 0
              ? selectedItems
              : dmCategory
                ? Object.values(fullMaterialMap).filter(mat => mat.material_category === dmCategory).map(mat => mat.name)
                : []
            const isOptional = !!dm?.optional ||
              (dm?.menu_name ?? dm?.name ?? '').toLowerCase().includes('optional')
            if (!menuName) return null
            return (
              <div key={i}>
                <label className="block text-[10px] text-gray-500 uppercase">{menuName}</label>
                <select
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 mb-2"
                  value={dropdownVals[menuName] ?? ''}
                  onChange={e => setDropdownVals(p => ({ ...p, [menuName]: e.target.value }))}
                >
                  {isOptional && <option value="">— None —</option>}
                  {items.length === 0
                    ? <option value="" disabled>No options available</option>
                    : items.map((item, j) => (
                        <option key={j} value={typeof item === 'string' ? item : (item as any).name ?? ''}>
                          {typeof item === 'string' ? item : (item as any).name ?? ''}
                        </option>
                      ))
                  }
                </select>
              </div>
            )
          })}
        </div>
      )}

      {/* 6. Calculate button */}
      <button type="button" onClick={handleCalculate} disabled={materialsLoading}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
        {materialsLoading ? 'Loading materials…' : 'Calculate Price'}
      </button>

      {/* 7. Results */}
      {results && (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500 min-w-[180px] resize-x overflow-auto">Item</th>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500">Type</th>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500">Formula</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Cost</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Total</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Sell</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((line, i) => (
                  <tr key={i} className={line.active ? '' : 'text-gray-300'}>
                    <td className="px-2 py-1.5 min-w-[180px] max-w-[220px] resize-x overflow-auto">
                      <span className={`truncate block ${!line.rateFound && line.active ? 'text-amber-600' : ''}`} title={line.name}>
                        {line.name}
                      </span>
                      {!line.rateFound && line.active && (
                        <span className="text-[9px] text-amber-500">rate not found</span>
                      )}
                      {!line.active && (
                        <span className="text-[9px] text-gray-400 italic">inactive</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><TypeBadge type={line.itemType} /></td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{line.formula}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{line.displayQty.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(line.unitCost)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {line.breakdown ? (
                        <div>
                          {line.breakdown.map((b, j) => (
                            <div key={j} className="text-[9px] text-gray-400 whitespace-nowrap text-left">{b}</div>
                          ))}
                          <div className="font-semibold">{fmt(line.totalCost)}</div>
                        </div>
                      ) : fmt(line.totalCost)}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${line.active && line.totalPrice > 0 ? 'font-semibold text-green-700' : ''}`}>
                      {fmt(line.totalPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <span className="text-gray-600">
              Total Cost: <span className="font-semibold tabular-nums">{fmt(grandTotalCost)}</span>
            </span>
            <span className="font-bold text-green-700">
              Sell Price: <span className="tabular-nums">{fmt(grandTotalPrice)}</span>
            </span>
            <span className="font-bold text-green-700">
              Margin: <span className="tabular-nums">{overallMargin.toFixed(1)}%</span>
            </span>
            {qty > 1 && (
              <span className="text-gray-500 text-xs">× {qty} units</span>
            )}
          </div>

          <p className="text-[10px] text-gray-400">
            ● Active &nbsp; ○ Inactive &nbsp;
            <span className="text-amber-500">rate not found</span> = not in PrintOS yet
          </p>
        </div>
      )}
    </div>
  )
}

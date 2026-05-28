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
  per_li_unit: boolean
  units: string | null
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
  material_type: string | null
}
type FullMaterialMap = Record<string, FullMaterialRow>

interface LineResult {
  name: string
  itemType: string
  formula: string
  displayQty: number   // computed_qty: time/area after production_rate, per piece
  units: string
  unitCost: number
  unitPrice: number
  perLiUnit: boolean
  liQty: number
  totalCost: number
  totalPrice: number
  active: boolean
  rateFound: boolean
  isMaterial: boolean
}

function fmt(n: number) {
  return '$' + n.toFixed(2)
}

// Format qty to 3dp, trim trailing zeros (e.g. 0.267, 32, 0.16)
function fmtQty(n: number): string {
  return n.toFixed(3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '0'
}

function formulaToUnits(formula: string): string {
  const f = (formula ?? '').toLowerCase().trim()
  if (f === 'area' || f.includes('area')) return 'Sqft'
  if (f === 'perimeter' || f.includes('perim')) return 'Ft'
  if (f === 'height' || f === 'width') return 'Ft'
  return 'Unit'
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
        per_li_unit: r.per_li_unit ?? false,
        units: r.units ?? null,
      }
    }
  }
  return m
}

function findMaterial(map: FullMaterialMap, name: string): FullMaterialRow | undefined {
  return map[name.trim().toLowerCase()]
}

// Safe formula evaluator — replaces modifier variable names then evaluates.
// Final pass replaces any remaining identifiers with 0 to prevent ReferenceError.
function evalExpression(expr: string, vars: Record<string, any>): number {
  let s = expr
  const names = Object.keys(vars).sort((a, b) => b.length - a.length)
  for (const name of names) {
    const v = vars[name]
    const replacement = typeof v === 'boolean' ? String(v) : String(parseFloat(String(v)) || 0)
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    s = s.replace(new RegExp('(?<![A-Za-z0-9_])' + escaped + '(?![A-Za-z0-9_])', 'g'), replacement)
  }
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
    return <span className="inline-flex rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium">Mat</span>
  if (t === 'laborrate' || t === 'labor')
    return <span className="inline-flex rounded-full bg-purple-100 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">Labor</span>
  if (t === 'machinerate' || t === 'machine')
    return <span className="inline-flex rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 text-[10px] font-medium">Mach</span>
  return null
}

// Build a RateRecord for computeLineItem from a local RateRow
function toRateRecord(rate: RateRow): RateRecord {
  return {
    name: rate.name,
    cost: rate.cost,
    price: rate.price,
    markup: rate.markup,
    production_rate: rate.production_rate ?? undefined,
    setup_charge: rate.setup_charge ?? undefined,
    other_charge: rate.other_charge ?? undefined,
    units: rate.units ?? undefined,
    per_li_unit: rate.per_li_unit,
  }
}

export default function ShopvoxQuotePreview({ shopvoxData, productName: _productName, orgSlug }: Props) {
  const modifiers: any[] = shopvoxData?.modifiers ?? []
  const dropdownMenus: any[] = shopvoxData?.dropdown_menus ?? []
  const defaultItems: any[] = shopvoxData?.default_items ?? []

  // ── state ─────────────────────────────────────────────────────
  const [qty, setQty] = useState(1)
  const [modVals, setModVals] = useState<Record<string, any>>({})

  // all dropdowns start blank — user always picks
  const [dropdownVals, setDropdownVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const dm of (shopvoxData?.dropdown_menus ?? [])) {
      const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
      if (menuName) init[menuName] = ''
    }
    return init
  })

  const [ratesLoading, setRatesLoading] = useState(true)
  const [ratesError, setRatesError] = useState<string | null>(null)
  const [laborMap, setLaborMap] = useState<RateMap>({})
  const [machineMap, setMachineMap] = useState<RateMap>({})
  const [fullMaterialMap, setFullMaterialMap] = useState<FullMaterialMap>({})
  const fullMaterialMapRef = useRef<FullMaterialMap>({})
  // use a ref so the debounce effect never reads stale ratesReady
  const ratesReadyRef = useRef(false)
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

  // init all dropdowns to blank on shopvoxData change
  useEffect(() => {
    if (!shopvoxData?.dropdown_menus?.length) return
    const init: Record<string, string> = {}
    for (const dm of (shopvoxData.dropdown_menus as any[])) {
      const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
      if (menuName) init[menuName] = ''
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
          supabase.from('labor_rates')
            .select('name, cost, price, markup, production_rate, setup_charge, other_charge, per_li_unit, units')
            .eq('organization_id', orgId).eq('active', true),
          supabase.from('machine_rates')
            .select('name, cost, price, markup, production_rate, setup_charge, other_charge, per_li_unit, units')
            .eq('organization_id', orgId).eq('active', true),
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
              material_type: r.material_type ?? null,
            }
          }
          setFullMaterialMap(matData)
          fullMaterialMapRef.current = matData
          setMaterialsLoading(false)
          ratesReadyRef.current = true
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
    if (!ratesReadyRef.current) return

    const widthInches  = parseFloat(String(modVals['Width']  ?? modVals['width']  ?? 48)) || 48
    const heightInches = parseFloat(String(modVals['Height'] ?? modVals['height'] ?? 96)) || 96
    const widthFt  = widthInches / 12
    const heightFt = heightInches / 12
    const q = Math.max(1, qty)

    const lines: LineResult[] = []

    // ── default items ────────────────────────────────────────────
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
            return optName === name.trim().toLowerCase()
          })
        })
        if (isDropdownControlled) {
          active = Object.values(dropdownVals).some(val =>
            (val ?? '').trim().toLowerCase() === name.trim().toLowerCase()
          )
        }
      }

      const typeLower = rawType.toLowerCase().replace('_', '')
      const isMat = typeLower === 'material'

      if (isMat) {
        // ── material line item ───────────────────────────────────
        const mat = findMaterial(fullMaterialMapRef.current, name)
        const matUnits = formulaToUnits(mat?.formula ?? itemFormula)
        // Call with qty=1,perLiUnit=false to get per-piece cost; caller applies liQty
        let displayQty = multiplier * numModFactor
        let perPieceCost = 0
        let perPiecePrice = 0
        if (mat) {
          const res = computeMaterialLineItem(
            { cost: mat.cost, formula: mat.formula ?? itemFormula, fixed_side: mat.fixed_side, width: mat.width, height: mat.height, wastage_markup: mat.wastage_markup, calculate_wastage: mat.calculate_wastage },
            widthInches, heightInches, 1, multiplier * numModFactor, false
          )
          displayQty = res.finalQty
          perPieceCost = res.lineTotal
          perPiecePrice = mat.price > 0 && mat.cost > 0 ? res.lineTotal * (mat.price / mat.cost) : res.lineTotal
        }
        const liQty = active ? q : 0
        lines.push({
          name, itemType: rawType, formula: itemFormula,
          displayQty, units: matUnits,
          unitCost: mat?.cost ?? 0, unitPrice: mat?.price ?? 0,
          perLiUnit: true, liQty,
          totalCost: active && mat ? perPieceCost * liQty : 0,
          totalPrice: active && mat ? perPiecePrice * liQty : 0,
          active, rateFound: !!mat, isMaterial: true,
        })
      } else {
        // ── rate line item (labor / machine) ─────────────────────
        const perPiece = computeFormula(itemFormula, widthFt, heightFt)
        const formulaQty = perPiece * multiplier * numModFactor
        const rateMap =
          typeLower === 'laborrate' || typeLower === 'labor' ? laborMap
          : typeLower === 'machinerate' || typeLower === 'machine' ? machineMap
          : laborMap
        const rate = rateMap[name.trim().toLowerCase()]
        const perLiUnit = rate?.per_li_unit ?? false
        const liQty = perLiUnit ? q : 1

        let displayQty = formulaQty
        let perPieceCost = 0
        let perPiecePrice = 0
        let rateUnits = rate?.units ?? ''

        if (rate) {
          // Pass qty=1 to get per-piece cost; production_rate is applied inside
          const res = computeLineItem(toRateRecord(rate), formulaQty, 1)
          displayQty = res.computed_qty  // chargeableUnits (formulaQty / production_rate or formulaQty)
          rateUnits = res.units ?? rate.units ?? ''
          perPieceCost = res.totalCost   // chargeableUnits × rate.cost (per 1 piece)
          perPiecePrice = res.totalPrice // chargeableUnits × rate.price (per 1 piece)
        }

        lines.push({
          name, itemType: rawType, formula: itemFormula,
          displayQty, units: rateUnits,
          unitCost: rate?.cost ?? 0, unitPrice: rate?.price ?? 0,
          perLiUnit, liQty: active ? liQty : 0,
          totalCost: active && rate ? perPieceCost * liQty : 0,
          totalPrice: active && rate ? perPiecePrice * liQty : 0,
          active, rateFound: !!rate, isMaterial: false,
        })
      }
    }

    // ── material dropdown items ──────────────────────────────────
    for (const dm of dropdownMenus) {
      const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
      if ((dm?.item_type ?? '').toLowerCase() !== 'material') continue
      const selectedVal = dropdownVals[menuName] ?? ''
      if (!selectedVal) continue

      const dmAttachNum: string = (dm?.attach_num_modifier ?? '').trim()
      const dmAttachNumQty: number = dmAttachNum ? (parseFloat(String(modVals[dmAttachNum] ?? 0)) || 0) : 0
      const hasDmAttachNum = !!dmAttachNum

      if (hasDmAttachNum && dmAttachNumQty <= 0) {
        lines.push({ name: selectedVal, itemType: 'Material', formula: 'Unit', displayQty: 1, units: 'Unit', unitCost: 0, unitPrice: 0, perLiUnit: true, liQty: 0, totalCost: 0, totalPrice: 0, active: false, rateFound: true, isMaterial: true })
        continue
      }

      const mat = findMaterial(fullMaterialMapRef.current, selectedVal)
      if (!mat) {
        lines.push({ name: selectedVal, itemType: 'Material', formula: 'Area', displayQty: 0, units: 'Sqft', unitCost: 0, unitPrice: 0, perLiUnit: true, liQty: q, totalCost: 0, totalPrice: 0, active: true, rateFound: false, isMaterial: true })
        continue
      }

      if (hasDmAttachNum) {
        // attach_num_modifier overrides qty: charge dmAttachNumQty × unit price
        lines.push({ name: selectedVal, itemType: 'Material', formula: 'Unit', displayQty: 1, units: formulaToUnits(mat.formula ?? 'Area'), unitCost: mat.cost, unitPrice: mat.price, perLiUnit: true, liQty: dmAttachNumQty, totalCost: mat.cost * dmAttachNumQty, totalPrice: mat.price * dmAttachNumQty, active: true, rateFound: true, isMaterial: true })
      } else {
        const res = computeMaterialLineItem(
          { cost: mat.cost, formula: mat.formula ?? 'Area', fixed_side: mat.fixed_side, width: mat.width, height: mat.height, wastage_markup: mat.wastage_markup, calculate_wastage: mat.calculate_wastage },
          widthInches, heightInches, 1, 1, false
        )
        const matUnits = formulaToUnits(mat.formula ?? 'Area')
        const perPiecePrice = mat.price > 0 && mat.cost > 0 ? res.lineTotal * (mat.price / mat.cost) : res.lineTotal
        lines.push({ name: selectedVal, itemType: 'Material', formula: mat.formula ?? 'Area', displayQty: res.finalQty, units: matUnits, unitCost: mat.cost, unitPrice: mat.price, perLiUnit: true, liQty: q, totalCost: res.lineTotal * q, totalPrice: perPiecePrice * q, active: true, rateFound: true, isMaterial: true })
      }
    }

    // ── machine/labor rate dropdown items ────────────────────────
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
        lines.push({ name: selectedVal, itemType: dm?.item_type ?? 'MachineRate', formula: 'Unit', displayQty: 1, units: '', unitCost: 0, unitPrice: 0, perLiUnit: false, liQty: 0, totalCost: 0, totalPrice: 0, active: false, rateFound: true, isMaterial: false })
        continue
      }

      const rateMap = (dmTypeLower === 'machinerate' || dmTypeLower === 'machine') ? machineMap : laborMap
      const rate = rateMap[selectedVal.trim().toLowerCase()]
      if (!rate) {
        lines.push({ name: selectedVal, itemType: dm?.item_type ?? 'MachineRate', formula: 'Unit', displayQty: 1, units: '', unitCost: 0, unitPrice: 0, perLiUnit: false, liQty: 0, totalCost: 0, totalPrice: 0, active: true, rateFound: false, isMaterial: false })
        continue
      }

      if (hasDmAttachNum) {
        // attach_num_modifier overrides qty
        lines.push({ name: selectedVal, itemType: dm?.item_type ?? 'MachineRate', formula: 'Unit', displayQty: 1, units: rate.units ?? '', unitCost: rate.cost, unitPrice: rate.price, perLiUnit: rate.per_li_unit, liQty: dmAttachNumQty, totalCost: rate.cost * dmAttachNumQty, totalPrice: rate.price * dmAttachNumQty, active: true, rateFound: true, isMaterial: false })
      } else {
        // formulaQty=1 for dropdown rates (they're Unit-based; selection picks the rate)
        const res = computeLineItem(toRateRecord(rate), 1, 1)
        const liQty = rate.per_li_unit ? q : 1
        lines.push({ name: selectedVal, itemType: dm?.item_type ?? 'MachineRate', formula: 'Unit', displayQty: res.computed_qty, units: res.units ?? rate.units ?? '', unitCost: rate.cost, unitPrice: rate.price, perLiUnit: rate.per_li_unit, liQty, totalCost: res.totalCost * liQty, totalPrice: res.totalPrice * liQty, active: true, rateFound: true, isMaterial: false })
      }
    }

    const gCost = lines.reduce((s, l) => s + l.totalCost, 0)
    const gPrice = lines.reduce((s, l) => s + l.totalPrice, 0)
    setResults(lines)
    setGrandTotalCost(gCost)
    setGrandTotalPrice(gPrice)
  }

  // debounce uses ratesReadyRef (ref) so the check is never stale
  useEffect(() => {
    if (!ratesReadyRef.current) return
    if ((modVals['Width'] ?? 0) === 0 && (modVals['Height'] ?? 0) === 0) return
    const timer = setTimeout(() => { handleCalculate() }, 400)
    return () => clearTimeout(timer)
  }, [modVals, dropdownVals]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── guard clauses ─────────────────────────────────────────────
  if (!shopvoxData) {
    return <div className="text-xs text-gray-400 italic py-6 text-center">No ShopVOX data available.</div>
  }
  if (defaultItems.length === 0) {
    return <div className="text-xs text-gray-400 italic py-6 text-center">No default items found in ShopVOX data.</div>
  }

  const overallMargin = grandTotalPrice > 0 ? ((grandTotalPrice - grandTotalCost) / grandTotalPrice) * 100 : 0

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
      {/* Header */}
      <div>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">ShopVOX Reference Pricing</p>
        <p className="text-[10px] text-gray-400 italic">Compare this to the PrintOS Builder on the right →</p>
      </div>

      {ratesLoading && (
        <div className="flex items-center gap-2 text-gray-400 py-1">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent" />
          Loading rates…
        </div>
      )}
      {ratesError && <p className="text-red-500">{ratesError}</p>}

      {/* QTY */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-500 font-medium">QTY</span>
        <input type="number" min={1} value={qty}
          onChange={e => setQty(parseInt(e.target.value) || 1)}
          className="w-16 border border-gray-300 rounded px-1.5 py-1 text-xs" />
      </div>

      {/* Numeric modifiers */}
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

      {/* Boolean checkboxes */}
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

      {/* Dropdowns — all start blank; fallback filters by material_type */}
      {dropdownMenus.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Dropdown Selections</p>
          {dropdownMenus.map((dm, i) => {
            const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
            if (!menuName) return null
            const selectedItems: string[] = dm?.selected_items ?? []
            const dmCategory: string | undefined = dm?.category
            const items: string[] = selectedItems.length > 0
              ? selectedItems
              : (dmCategory && dmCategory !== '-')
                ? Object.values(fullMaterialMap)
                    .filter(mat => mat.material_type === dmCategory)
                    .map(mat => mat.name)
                    .sort()
                : []
            return (
              <div key={i}>
                <label className="block text-[10px] text-gray-500 uppercase">{menuName}</label>
                <select
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 mb-2"
                  value={dropdownVals[menuName] ?? ''}
                  onChange={e => setDropdownVals(p => ({ ...p, [menuName]: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {items.length === 0
                    ? <option value="" disabled>No options available</option>
                    : items.map((item, j) => {
                        const label = typeof item === 'string' ? item : (item as any).name ?? ''
                        return <option key={j} value={label}>{label}</option>
                      })
                  }
                </select>
              </div>
            )
          })}
        </div>
      )}

      {/* Calculate button */}
      <button type="button" onClick={handleCalculate} disabled={materialsLoading}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
        {materialsLoading ? 'Loading materials…' : 'Calculate Price'}
      </button>

      {/* Results table — Name | Qty | Unit | Unit Cost | Unit Price | LI Qty | Total Cost | Total Price */}
      {results && (
        <div className="space-y-1">
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500 min-w-[160px]">Name</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Qty</th>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500">Unit</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Unit Cost</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Unit Price</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">LI Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Total Cost</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Total Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((line, i) => (
                  <tr key={i} className={line.active ? '' : 'text-gray-300'}>
                    <td className="px-2 py-1.5 min-w-[160px] max-w-[220px]">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className={`truncate ${!line.rateFound && line.active ? 'text-amber-600' : ''}`} title={line.name}>
                          {line.name}
                        </span>
                        <TypeBadge type={line.itemType} />
                      </div>
                      {!line.rateFound && line.active && <span className="text-[9px] text-amber-500">rate not found</span>}
                      {!line.active && <span className="text-[9px] text-gray-400 italic">inactive</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtQty(line.displayQty)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-500">{line.units}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(line.unitCost)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(line.unitPrice)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{line.liQty}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(line.totalCost)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${line.active && line.totalPrice > 0 ? 'font-semibold' : ''}`}
                      style={line.active && line.totalPrice > 0 ? { color: '#93ca3b' } : undefined}>
                      {fmt(line.totalPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400">
            ● Active &nbsp;○ Inactive &nbsp;<span className="text-amber-500">rate not found</span> = not in PrintOS yet
          </p>
        </div>
      )}

      {/* Sticky totals bar — always visible at bottom of scroll container */}
      <div className="sticky bottom-0 bg-white border-t-2 border-green-500 p-3 flex flex-wrap gap-4 items-center z-10 shadow-md">
        <span className="text-gray-600 text-xs">
          Cost: <span className="font-semibold tabular-nums">{results ? fmt(grandTotalCost) : '—'}</span>
        </span>
        <span className="text-xs font-bold" style={{ color: '#93ca3b' }}>
          Sell: <span className="tabular-nums">{results ? fmt(grandTotalPrice) : '—'}</span>
        </span>
        <span className="text-xs font-semibold text-gray-700">
          Margin: <span className="tabular-nums">{results ? `${overallMargin.toFixed(1)}%` : '—'}</span>
        </span>
        {results && qty > 1 && <span className="text-gray-500 text-xs">× {qty} units</span>}
      </div>
    </div>
  )
}

'use client'

import React, { useState } from 'react'

type Props = {
  shopvoxData: any
}

// Return the first non-null non-empty string among candidates.
function pick(...vals: any[]): string {
  for (const v of vals) {
    if (v != null && v !== '' && v !== null) return String(v)
  }
  return ''
}

// Read-only ShopVOX mirror -- checkboxes here are a review/import checklist
// (crossing an item off once it's been copied into the PrintOS recipe), not
// pricing controls. Deliberately does NOT price anything: Ruben's decision
// is that this panel is a reference view only, with "Check Reference Price"
// (added in PR #23) removed entirely -- all real pricing now lives on the
// Quote Preview tab, calculated through the actual PrintOS pricing engine
// (calculateProductPrice), not a parallel implementation here. See
// known-issues/2026-08-21-quote-preview-real-pricing.md.
export default function ShopVOXReferencePanel({ shopvoxData }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  function toggle(key: string) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  if (!shopvoxData || (!shopvoxData.basic && !shopvoxData.modifiers && !shopvoxData.default_items)) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400 italic">
        No ShopVOX data scraped yet for this product.
      </div>
    )
  }

  const basic = shopvoxData.basic ?? {}
  const pricing = shopvoxData.pricing ?? {}
  const modifiers: any[] = shopvoxData.modifiers ?? []
  const dropdownMenus: any[] = shopvoxData.dropdown_menus ?? []
  const defaultItems: any[] = shopvoxData.default_items ?? []
  const deepScrapedAt: string | undefined = shopvoxData.deep_scraped_at

  // Section 1 — Basic Info: [key, label, value]
  const basicRows: [string, string, string][] = (
    [
      ['basic_Type', 'Type', basic.type],
      ['basic_Category', 'Category', basic.category],
      ['basic_Workflow', 'Workflow', basic.workflow],
      ['basic_Display', 'Display Name', basic.display_name],
      ['basic_Secondary', 'Secondary Cat.', basic.secondary_category],
    ] as [string, string, any][]
  ).filter(([, , v]) => v != null && v !== '')
   .map(([k, l, v]): [string, string, string] => [k, l, String(v)])

  // Section 2 — Pricing
  const pricingRows: [string, string, string][] = (
    [
      ['pricing_formula', 'Formula', pricing.formula],
      ['pricing_units', 'Buying Units', pricing.buying_units],
      ['pricing_type', 'Pricing Type', pricing.pricing_type],
      ['pricing_method', 'Method', pricing.pricing_method],
      ['pricing_discount', 'Range Discount', pricing.range_discount],
    ] as [string, string, any][]
  ).filter(([, , v]) => v != null && v !== '')
   .map(([k, l, v]): [string, string, string] => [k, l, String(v)])

  return (
    <div className="text-xs space-y-4">
      {/* Header badge */}
      <div className="space-y-0.5">
        {basic.name && (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 font-medium">
            ShopVOX: {basic.name}
          </span>
        )}
        {deepScrapedAt && (
          <p className="text-[10px] text-gray-400">
            Scraped {new Date(deepScrapedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Section 1: Basic Info */}
      {basicRows.length > 0 && (
        <div>
          <SectionHeader title="Basic Info" />
          <table className="w-full">
            <tbody>
              {basicRows.map(([key, label, val], i) => {
                const isDone = !!checked[key]
                return (
                  <tr key={key} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-1 pl-0.5 w-4 align-middle">
                      <input type="checkbox" checked={isDone} onChange={() => toggle(key)}
                        className="w-3 h-3 accent-green-500 cursor-pointer" />
                    </td>
                    <td className={`py-1 pr-2 font-medium whitespace-nowrap w-1/3 ${isDone ? 'line-through text-gray-400' : 'text-gray-500'}`}>{label}</td>
                    <td className={`py-1 break-words ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>{val}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Section 2: Pricing */}
      {pricingRows.length > 0 && (
        <div>
          <SectionHeader title="Pricing" />
          <table className="w-full">
            <tbody>
              {pricingRows.map(([key, label, val], i) => {
                const isDone = !!checked[key]
                return (
                  <tr key={key} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-1 pl-0.5 w-4 align-middle">
                      <input type="checkbox" checked={isDone} onChange={() => toggle(key)}
                        className="w-3 h-3 accent-green-500 cursor-pointer" />
                    </td>
                    <td className={`py-1 pr-2 font-medium whitespace-nowrap w-1/3 ${isDone ? 'line-through text-gray-400' : 'text-gray-500'}`}>{label}</td>
                    <td className={`py-1 break-words ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>{val}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Section 3: Modifiers */}
      <div>
        <SectionHeader title="Modifiers" count={modifiers.length} />
        {modifiers.length === 0 ? (
          <p className="text-gray-400 italic py-1">No modifiers.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-gray-400">
                <th className="w-4" />
                <th className="text-left py-1 font-medium">Name</th>
                <th className="text-left py-1 font-medium">Type</th>
                <th className="text-left py-1 font-medium">Default</th>
                <th className="text-left py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {modifiers.map((m, i) => {
                const key = `modifier_${i}`
                const isDone = !!checked[key]
                const mName = m?.Name ?? m?.name ?? m?.attribute ?? m?.Attribute ?? ''
                const mType = m?.Type ?? m?.type ?? ''
                const mDefault = m?.DefaultValue ?? m?.defaultValue ?? m?.default_value ?? m?.Default ?? m?.default ?? ''
                const mOptional = m?.optional === true || m?.optional === 'true' || m?.Optional === true
                const mDefaultStr = String(mDefault)
                const defDisplay = mDefaultStr.length > 20 ? mDefaultStr.slice(0, 20) + '…' : mDefaultStr
                return (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-1 pl-0.5 w-4 align-middle">
                      <input type="checkbox" checked={isDone} onChange={() => toggle(key)}
                        className="w-3 h-3 accent-green-500 cursor-pointer" />
                    </td>
                    <td className={`py-1 pr-2 ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>{mName}</td>
                    <td className={`py-1 pr-2 ${isDone ? 'line-through text-gray-400' : 'text-gray-600'}`}>{mType}</td>
                    <td className={`py-1 pr-2 ${isDone ? 'line-through text-gray-400' : 'text-gray-500'}`} title={mDefaultStr}>{defDisplay}</td>
                    <td className="py-1">
                      {mOptional && (
                        <span className="inline-flex rounded-full bg-green-100 text-green-700 px-1.5 py-0.5 text-[10px] font-medium">
                          Optional
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Section 4: Dropdown Menus */}
      <div>
        <SectionHeader title="Dropdown Menus" count={dropdownMenus.length} />
        {dropdownMenus.length === 0 ? (
          <p className="text-gray-400 italic py-1">No dropdown menus.</p>
        ) : (
          <div className="space-y-3">
            {dropdownMenus.map((dm, i) => {
              const key = `dropdown_${i}`
              const isDone = !!checked[key]
              const menuName = pick(dm.menu_name, dm['Menu Name'], dm.name, dm.Name)
              const items: string[] = dm.selected_items ?? dm.items ?? []
              return (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-1">
                    <input type="checkbox" checked={isDone} onChange={() => toggle(key)}
                      className="w-3 h-3 accent-green-500 cursor-pointer shrink-0" />
                    <span className={`font-bold ${isDone ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                      {menuName}
                    </span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-gray-400 italic pl-5">No items selected.</p>
                  ) : (
                    <div className={`flex flex-wrap gap-1 pl-5 ${isDone ? 'opacity-40' : ''}`}>
                      {items.map((item, j) => (
                        <span key={j} className="inline-flex bg-gray-100 text-gray-600 rounded px-2 py-0.5 text-xs">
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Section 5: Default Items */}
      <div>
        <SectionHeader title="Default Items" count={defaultItems.length} />
        {defaultItems.length === 0 ? (
          <p className="text-gray-400 italic py-1">No default items.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-gray-400">
                <th className="w-4" />
                <th className="text-left py-1 font-medium">Name</th>
                <th className="text-left py-1 font-medium">Type</th>
                <th className="text-left py-1 font-medium">Formula</th>
                <th className="text-left py-1 font-medium">Mult.</th>
                <th className="text-center py-1 font-medium">Per LI</th>
                <th className="text-left py-1 font-medium">Fixed</th>
                <th className="text-left py-1 font-medium">Mods</th>
              </tr>
            </thead>
            <tbody>
              {defaultItems.map((d, i) => {
                const key = `defaultitem_${i}`
                const isDone = !!checked[key]
                const dName = d?.Name ?? d?.name ?? ''
                const dType = d?.['Item Type'] ?? d?.item_type ?? d?.ItemType ?? d?.Type ?? d?.type ?? ''
                const dFormula = d?.formula ?? d?.Formula ?? ''
                const dMult = d?.multiplier ?? d?.Multiplier ?? ''
                const dNumMod = d?.attach_num_modifier ?? d?.num_modifier ?? ''
                const dChkMod = d?.attach_chk_modifier ?? d?.chk_modifier ?? ''
                const dPerLi: boolean = !!(d?.per_li_unit ?? d?.per_li ?? false)
                const dFixedSide: string = (() => {
                  const fs = d?.fixed_side ?? d?.fixedSide ?? null
                  if (fs === 'width') return 'W'
                  if (fs === 'height') return 'H'
                  if (fs === 'both') return 'Both'
                  return '—'
                })()
                const dFormulaStr = String(dFormula)
                const formulaDisplay = dFormulaStr.length > 18 ? dFormulaStr.slice(0, 18) + '…' : dFormulaStr
                const typeStr = String(dType).toLowerCase().replace('_', '')
                return (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-1 pl-0.5 w-4 align-middle">
                      <input type="checkbox" checked={isDone} onChange={() => toggle(key)}
                        className="w-3 h-3 accent-green-500 cursor-pointer" />
                    </td>
                    <td className={`py-1 pr-2 ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>{dName}</td>
                    <td className="py-1 pr-2">
                      <ItemTypeBadge type={String(dType)} />
                    </td>
                    <td className={`py-1 pr-2 font-mono ${isDone ? 'line-through text-gray-400' : 'text-gray-600'}`} title={dFormulaStr}>{formulaDisplay}</td>
                    <td className={`py-1 pr-2 ${isDone ? 'line-through text-gray-400' : 'text-gray-600'}`}>{dMult !== '' && dMult != null ? String(dMult) : ''}</td>
                    <td className="py-1 text-center text-[10px]">
                      <span className={dPerLi ? 'text-green-600' : 'text-gray-300'}>{dPerLi ? '✓' : '✗'}</span>
                    </td>
                    <td className={`py-1 pr-2 text-[10px] ${isDone ? 'text-gray-300' : 'text-gray-500'}`}>
                      {typeStr === 'material' ? dFixedSide : ''}
                    </td>
                    <td className="py-1 text-[10px] text-gray-500 space-y-0.5">
                      {dNumMod && <span className="block">× {dNumMod}</span>}
                      {dChkMod && <span className="block">✓ {dChkMod}</span>}
                    </td>
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

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-200 pb-1 mb-2">
      <span className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">{title}</span>
      {count !== undefined && (
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 font-medium">
          ({count})
        </span>
      )}
    </div>
  )
}

function ItemTypeBadge({ type }: { type: string }) {
  const t = (type ?? '').toLowerCase().replace('_', '')
  if (t === 'material')
    return <span className="inline-flex rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium">Material</span>
  if (t === 'laborrate' || t === 'labor')
    return <span className="inline-flex rounded-full bg-purple-100 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">LaborRate</span>
  if (t === 'machinerate' || t === 'machine')
    return <span className="inline-flex rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 text-[10px] font-medium">MachineRate</span>
  return <span className="text-gray-500 text-[10px]">{type}</span>
}

'use client'

import { useMemo, useState, useTransition } from 'react'
import type { ShopvoxMaterialRow } from '@/lib/material-migrate-proposals'
import type { FamilyProposal, FamilyColourGroup, FamilyVariant } from '@/lib/material-family-proposals'
import { acceptSubstrateProposal, applyChangedFields, type AcceptColourInput, type AcceptVariantInput } from './actions'

type FullRow = ShopvoxMaterialRow & {
  migrated_to_material_id: string | null
  migrated_at: string | null
  source_hash: string
  migrated_source_hash: string | null
}

type LinkedMaterial = {
  id: string; name: string; width: number | null; height: number | null; sheet_cost: number | null
  cost: number | null; price: number | null; multiplier: number | null; preferred_vendor: string | null
  part_number: string | null; sku: string | null; po_description: string | null; info_url: string | null
  description: string | null
}

type Props = {
  orgId: string
  orgSlug: string
  substrateTypeFound: boolean
  rows: FullRow[]
  proposals: FamilyProposal[]
  linkedMaterials: Record<string, unknown>[]
  migratedMaterialNames: { id: string; name: string }[]
}

type Tab = 'NEW' | 'CHANGED' | 'MIGRATED'

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-green-50 text-green-700 border-green-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-red-50 text-red-700 border-red-200',
}

// Editable copy of a FamilyVariant, plus this screen's own state.
type EditableVariant = FamilyVariant & { isDefault: boolean; removed: boolean }
// Editable copy of a FamilyColourGroup — "Colour / Finish" is the UI
// label everywhere (per instruction: the real data includes Mill, Brite
// Brushed Gold, Painted 1 Side — finishes and prep states, not colours;
// the grouping is right, only the word was wrong). Internal field names
// and the material_colors table name stay "colour" throughout.
type EditableColourFinish = { key: string; name: string; code: string; isStocked: boolean; removed: boolean; variants: EditableVariant[] }

function pickDefaultIndex(variants: FamilyVariant[]): number {
  const noSizeIdx = variants.findIndex((v) => v.sizeLabel === null)
  return noSizeIdx >= 0 ? noSizeIdx : 0
}

function buildEditableState(proposal: FamilyProposal): EditableColourFinish[] {
  return proposal.colours.map((c: FamilyColourGroup, ci) => {
    const defaultIdx = pickDefaultIndex(c.variants)
    return {
      key: `${proposal.key}::${ci}`,
      name: c.colourName ?? '',
      code: c.code ?? '',
      isStocked: false,
      removed: false,
      variants: c.variants.map((v, vi) => ({ ...v, isDefault: vi === defaultIdx, removed: false })),
    }
  })
}

export default function MigrateClient({ orgId, orgSlug, substrateTypeFound, rows, proposals, linkedMaterials, migratedMaterialNames }: Props) {
  const [tab, setTab] = useState<Tab>('NEW')
  const [selectedKey, setSelectedKey] = useState<string | null>(proposals[0]?.key ?? null)
  const [familyNameOverride, setFamilyNameOverride] = useState<string | null>(null)
  const [editableColours, setEditableColours] = useState<EditableColourFinish[] | null>(null)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])

  const rowsByStatus = useMemo(() => ({
    NEW: rows.filter((r) => r.status === 'NEW'),
    CHANGED: rows.filter((r) => r.status === 'CHANGED'),
    MIGRATED: rows.filter((r) => r.status === 'MIGRATED'),
  }), [rows])

  const materialById = useMemo(() => {
    const m = new Map<string, LinkedMaterial>()
    for (const lm of linkedMaterials) m.set((lm as LinkedMaterial).id, lm as LinkedMaterial)
    return m
  }, [linkedMaterials])

  const migratedNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const mm of migratedMaterialNames) m.set(mm.id, mm.name)
    return m
  }, [migratedMaterialNames])

  const selectedProposal = proposals.find((p) => p.key === selectedKey) ?? null
  const activeColours = editableColours ?? (selectedProposal ? buildEditableState(selectedProposal) : [])
  const defaultFamilyName = selectedProposal ? `${selectedProposal.line}${selectedProposal.axisValue ? ` ${selectedProposal.axisValue}` : ''}`.trim() : ''

  function selectProposal(p: FamilyProposal) {
    setSelectedKey(p.key)
    setEditableColours(null)
    setFamilyNameOverride(null)
    setMessage(null)
  }

  function updateColour(idx: number, patch: Partial<EditableColourFinish>) {
    const next = activeColours.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    setEditableColours(next)
  }

  function removeColour(idx: number) {
    updateColour(idx, { removed: true })
  }

  function updateVariant(colourIdx: number, variantIdx: number, patch: Partial<EditableVariant>) {
    const next = activeColours.map((c, ci) => {
      if (ci !== colourIdx) return c
      const variants = c.variants.map((v, vi) => {
        if (vi !== variantIdx) return { ...v, isDefault: patch.isDefault ? false : v.isDefault }
        return { ...v, ...patch }
      })
      return { ...c, variants }
    })
    setEditableColours(next)
  }

  function removeVariant(colourIdx: number, variantIdx: number) {
    updateVariant(colourIdx, variantIdx, { removed: true })
  }

  // Vendor seed + legacy pricing fields are sourced from the raw
  // shopvox_materials rows (not the proposal object, which only carries
  // grouping/colour/size structure) — the first non-excluded row across
  // all remaining colours, same "best available" approach Build 1 used.
  function pickSeedRow(colours: EditableColourFinish[]): FullRow | null {
    for (const c of colours) {
      if (c.removed) continue
      for (const v of c.variants) {
        if (v.removed) continue
        const row = rowById.get(v.sourceRowId)
        if (row) return row
      }
    }
    return null
  }

  function pickVendorSeed(seedRow: FullRow | null) {
    if (!seedRow) return null
    const best = [...(seedRow.vendor_pricing ?? [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0]
    if (best?.vendor_name) return { vendorName: best.vendor_name, vendorPrice: best.price, partNumber: best.part_number, rank: best.rank }
    if (seedRow.preferred_vendor) return { vendorName: seedRow.preferred_vendor, vendorPrice: seedRow.cost, partNumber: seedRow.part_number, rank: null }
    return null
  }

  function handleAccept() {
    if (!selectedProposal) return
    const remainingColours = activeColours.filter((c) => !c.removed && c.variants.some((v) => !v.removed))
    if (remainingColours.length === 0) { setMessage('Every colour/finish is removed — nothing to accept.'); return }

    const colours: AcceptColourInput[] = remainingColours.map((c) => {
      const variants: AcceptVariantInput[] = c.variants
        .filter((v) => !v.removed)
        .map((v) => ({ height: v.height, width: v.width, lengthIncrement: v.lengthIncrement, isDefault: v.isDefault, baseCost: null, multiplier: null }))
      return { name: c.name.trim() || null, code: c.code.trim() || null, isStocked: c.isStocked, variants }
    })

    const sourceRowIds = remainingColours.flatMap((c) => c.variants.filter((v) => !v.removed).map((v) => v.sourceRowId))
    const seedRow = pickSeedRow(remainingColours)
    const vendorSeed = pickVendorSeed(seedRow)
    const familyName = (familyNameOverride ?? defaultFamilyName).trim()
    if (!familyName) { setMessage('Family name is required.'); return }

    startTransition(async () => {
      const result = await acceptSubstrateProposal({
        orgId, orgSlug,
        familyName,
        materialTypeId: selectedProposal.materialTypeId,
        categoryId: selectedProposal.categoryId,
        sourceRowIds,
        colours,
        vendorSeed,
        legacyFields: {
          cost: seedRow?.cost ?? null, price: seedRow?.price ?? null, sheetCost: seedRow?.sheet_cost ?? null,
          multiplier: seedRow?.multiplier ?? null, weight: null,
          partNumber: seedRow?.part_number ?? null, sku: seedRow?.sku ?? null,
          poDescription: seedRow?.po_description ?? null, infoUrl: seedRow?.info_url ?? null,
          description: seedRow?.description ?? null,
        },
      })
      if (result.error) setMessage(`Error: ${result.error}`)
      else {
        setMessage(`Created material "${familyName}".`)
        setSelectedKey(null)
        setEditableColours(null)
      }
    })
  }

  if (!substrateTypeFound) {
    return <div className="p-6 text-sm text-red-700">Material type &ldquo;Rigid Substrates- Sheets&rdquo; not found for this org — nothing to migrate.</div>
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Migrate Materials from ShopVOX</h1>
        <p className="mt-1 text-sm text-gray-500">Substrates only. Left is the read-only ShopVOX scrape, grouped into proposed families. Right is a pre-filled proposal — nothing is written to PrintOS until you accept it.</p>
      </div>

      {message && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">{message}</div>
      )}

      <div className="flex gap-1 border-b border-gray-200">
        {(['NEW', 'CHANGED', 'MIGRATED'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t} ({rowsByStatus[t].length})
          </button>
        ))}
      </div>

      {tab === 'NEW' && (
        <div className="grid grid-cols-2 gap-4">
          {/* LEFT: read-only proposed families */}
          <div className="rounded-md border border-gray-200">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium uppercase text-gray-500">Proposed families ({proposals.length})</div>
            <div className="max-h-[75vh] overflow-y-auto divide-y divide-gray-100">
              {proposals.map((p) => {
                const label = `${p.line}${p.axisValue ? ` ${p.axisValue}` : ''}`
                return (
                  <button
                    key={p.key}
                    onClick={() => selectProposal(p)}
                    className={`block w-full px-3 py-2 text-left ${selectedKey === p.key ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{label}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${CONFIDENCE_STYLE[p.confidence]}`}>{p.confidence}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {p.sourceRowIds.length} row{p.sourceRowIds.length === 1 ? '' : 's'} · {p.colours.length} colour/finish{p.colours.length === 1 ? '' : 'es'}
                    </div>
                    {/* Reasoning always visible, per instruction -- so Ruben can
                        see WHY a family grouped (or a LOW row declined to
                        group) before he ever clicks in, not just that it did. */}
                    <div className="mt-1 text-[11px] text-gray-400 line-clamp-2">{p.reasoning}</div>
                  </button>
                )
              })}
              {proposals.length === 0 && <div className="p-4 text-sm text-gray-500">Nothing new to migrate.</div>}
            </div>
          </div>

          {/* RIGHT: editable proposal */}
          <div className="rounded-md border border-gray-200">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium uppercase text-gray-500">Proposal</div>
            {!selectedProposal ? (
              <div className="p-4 text-sm text-gray-500">Select a family on the left.</div>
            ) : (
              <div className="space-y-3 p-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500">Material name</label>
                  <input
                    type="text"
                    className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm font-semibold text-gray-900"
                    value={familyNameOverride ?? defaultFamilyName}
                    onChange={(e) => setFamilyNameOverride(e.target.value)}
                  />
                </div>
                <div className={`rounded border px-2 py-1.5 text-xs ${CONFIDENCE_STYLE[selectedProposal.confidence]}`}>
                  <span className="font-semibold uppercase">{selectedProposal.confidence} confidence</span> — {selectedProposal.reasoning}
                </div>

                <div className="space-y-3">
                  {activeColours.map((c, ci) => {
                    if (c.removed) return null
                    return (
                      <div key={c.key} className="rounded border border-gray-200 p-2">
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] font-medium uppercase text-gray-500">Colour / Finish</label>
                          <input
                            type="text"
                            placeholder="(none)"
                            className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                            value={c.name}
                            onChange={(e) => updateColour(ci, { name: e.target.value })}
                          />
                          <input
                            type="text"
                            placeholder="code"
                            className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                            value={c.code}
                            onChange={(e) => updateColour(ci, { code: e.target.value })}
                          />
                          <label className="flex items-center gap-1 text-[11px] text-gray-600">
                            <input type="checkbox" checked={c.isStocked} onChange={(e) => updateColour(ci, { isStocked: e.target.checked })} /> Stocked
                          </label>
                          <button onClick={() => removeColour(ci)} className="text-xs text-red-600 hover:underline">Remove</button>
                        </div>

                        <table className="mt-2 w-full text-xs">
                          <thead>
                            <tr className="text-left text-gray-500">
                              <th className="w-8">Default</th><th>Height</th><th>Width</th><th>Length incr.</th><th>Source</th><th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.variants.map((v, vi) => {
                              if (v.removed) return null
                              return (
                                <tr key={v.sourceRowId}>
                                  <td><input type="radio" name={`default-${c.key}`} checked={v.isDefault} onChange={() => updateVariant(ci, vi, { isDefault: true })} /></td>
                                  <td><input type="number" className="w-16 rounded border border-gray-300 px-1 py-0.5" value={v.height ?? ''} onChange={(e) => updateVariant(ci, vi, { height: e.target.value === '' ? null : parseFloat(e.target.value) })} /></td>
                                  <td><input type="number" className="w-16 rounded border border-gray-300 px-1 py-0.5" value={v.width ?? ''} onChange={(e) => updateVariant(ci, vi, { width: e.target.value === '' ? null : parseFloat(e.target.value) })} /></td>
                                  <td><input type="number" className="w-16 rounded border border-gray-300 px-1 py-0.5" value={v.lengthIncrement ?? ''} onChange={(e) => updateVariant(ci, vi, { lengthIncrement: e.target.value === '' ? null : parseFloat(e.target.value) })} /></td>
                                  <td className="max-w-[140px] truncate text-gray-500" title={v.sourceName}>{v.sourceName}</td>
                                  <td><button onClick={() => removeVariant(ci, vi)} className="text-red-600 hover:underline">✕</button></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    disabled={pending}
                    onClick={handleAccept}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {pending ? 'Saving…' : 'Accept'}
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => { setSelectedKey(null); setEditableColours(null); setFamilyNameOverride(null) }}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'CHANGED' && (
        <ChangedTab
          orgId={orgId}
          orgSlug={orgSlug}
          rows={rowsByStatus.CHANGED}
          materialById={materialById}
          pending={pending}
          startTransition={startTransition}
          setMessage={setMessage}
        />
      )}

      {tab === 'MIGRATED' && (
        <div className="rounded-md border border-gray-200 divide-y divide-gray-100">
          {rowsByStatus.MIGRATED.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-gray-900">{r.name}</span>
              <span className="text-gray-500">→ {r.migrated_to_material_id ? migratedNameById.get(r.migrated_to_material_id) ?? r.migrated_to_material_id : '—'}</span>
            </div>
          ))}
          {rowsByStatus.MIGRATED.length === 0 && <div className="p-4 text-sm text-gray-500">Nothing migrated yet.</div>}
        </div>
      )}
    </div>
  )
}

const DIFF_FIELDS: { key: keyof LinkedMaterial; shopvoxKey: keyof FullRow; label: string }[] = [
  { key: 'width', shopvoxKey: 'width', label: 'Width' },
  { key: 'height', shopvoxKey: 'height', label: 'Height' },
  { key: 'sheet_cost', shopvoxKey: 'sheet_cost', label: 'Sheet cost' },
  { key: 'cost', shopvoxKey: 'cost', label: 'Cost' },
  { key: 'price', shopvoxKey: 'price', label: 'Price' },
  { key: 'multiplier', shopvoxKey: 'multiplier', label: 'Multiplier' },
  { key: 'preferred_vendor', shopvoxKey: 'preferred_vendor', label: 'Preferred vendor' },
  { key: 'part_number', shopvoxKey: 'part_number', label: 'Part number' },
  { key: 'sku', shopvoxKey: 'sku', label: 'SKU' },
  { key: 'po_description', shopvoxKey: 'po_description', label: 'PO description' },
  { key: 'info_url', shopvoxKey: 'info_url', label: 'Info URL' },
  { key: 'description', shopvoxKey: 'description', label: 'Description' },
]

function ChangedTab({ orgId, orgSlug, rows, materialById, pending, startTransition, setMessage }: {
  orgId: string; orgSlug: string; rows: FullRow[]; materialById: Map<string, LinkedMaterial>
  pending: boolean; startTransition: (callback: () => void) => void; setMessage: (m: string) => void
}) {
  const [checkedFields, setCheckedFields] = useState<Record<string, Set<string>>>({})

  function toggleField(rowId: string, field: string) {
    setCheckedFields((prev) => {
      const set = new Set(prev[rowId] ?? [])
      if (set.has(field)) set.delete(field)
      else set.add(field)
      return { ...prev, [rowId]: set }
    })
  }

  function apply(row: FullRow, material: LinkedMaterial) {
    const checked = checkedFields[row.id] ?? new Set<string>()
    const fieldsToApply: Record<string, string | number | boolean | null> = {}
    for (const f of DIFF_FIELDS) {
      if (checked.has(f.key)) fieldsToApply[f.key] = (row[f.shopvoxKey] as string | number | null) ?? null
    }
    startTransition(async () => {
      const result = await applyChangedFields({ orgId, orgSlug, shopvoxMaterialId: row.id, materialId: material.id, fieldsToApply })
      setMessage(result.error ? `Error: ${result.error}` : `Applied ${Object.keys(fieldsToApply).length} field(s) to "${material.name}".`)
    })
  }

  function dismiss(row: FullRow, material: LinkedMaterial) {
    startTransition(async () => {
      const result = await applyChangedFields({ orgId, orgSlug, shopvoxMaterialId: row.id, materialId: material.id, fieldsToApply: {} })
      setMessage(result.error ? `Error: ${result.error}` : `Dismissed — kept PrintOS values for "${material.name}".`)
    })
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const material = row.migrated_to_material_id ? materialById.get(row.migrated_to_material_id) : undefined
        if (!material) return null
        const diffFields = DIFF_FIELDS.filter((f) => (row[f.shopvoxKey] ?? null) !== (material[f.key] ?? null))
        return (
          <div key={row.id} className="rounded-md border border-amber-200 bg-amber-50/40 p-3">
            <div className="mb-2 text-sm font-medium text-gray-900">{row.name} <span className="text-gray-500">→ {material.name}</span></div>
            {diffFields.length === 0 ? (
              <div className="text-xs text-gray-500">No field-level differences detected (hash changed elsewhere — e.g. vendor pricing or tiers).</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500"><th className="w-8"></th><th>Field</th><th>ShopVOX now</th><th>PrintOS current</th></tr>
                </thead>
                <tbody>
                  {diffFields.map((f) => (
                    <tr key={f.key}>
                      <td><input type="checkbox" checked={(checkedFields[row.id] ?? new Set()).has(f.key)} onChange={() => toggleField(row.id, f.key)} /></td>
                      <td className="py-0.5 text-gray-700">{f.label}</td>
                      <td className="py-0.5 font-medium text-gray-900">{String(row[f.shopvoxKey] ?? '—')}</td>
                      <td className="py-0.5 text-gray-500">{String(material[f.key] ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-2 flex gap-2">
              <button disabled={pending} onClick={() => apply(row, material)} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">Apply checked fields</button>
              <button disabled={pending} onClick={() => dismiss(row, material)} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Dismiss (keep PrintOS values)</button>
            </div>
          </div>
        )
      })}
      {rows.length === 0 && <div className="rounded-md border border-gray-200 p-4 text-sm text-gray-500">Nothing changed since migration.</div>}
    </div>
  )
}

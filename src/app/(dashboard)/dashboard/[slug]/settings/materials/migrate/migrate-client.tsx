'use client'

import { useMemo, useState, useTransition } from 'react'
import type { ShopvoxMaterialRow, SubstrateProposal, ProposedVariant } from '@/lib/material-migrate-proposals'
import { acceptSubstrateProposal, applyChangedFields } from './actions'

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
  proposals: SubstrateProposal[]
  linkedMaterials: Record<string, unknown>[]
  migratedMaterialNames: { id: string; name: string }[]
}

type Tab = 'NEW' | 'CHANGED' | 'MIGRATED'

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-green-50 text-green-700 border-green-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-red-50 text-red-700 border-red-200',
}

export default function MigrateClient({ orgId, orgSlug, substrateTypeFound, rows, proposals, linkedMaterials, migratedMaterialNames }: Props) {
  const [tab, setTab] = useState<Tab>('NEW')
  const [selectedKey, setSelectedKey] = useState<string | null>(proposals[0]?.key ?? null)
  const [excludedRowIds, setExcludedRowIds] = useState<Set<string>>(new Set())
  const [editedVariants, setEditedVariants] = useState<Record<string, ProposedVariant[]>>({})
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

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
  const activeVariants = selectedProposal ? (editedVariants[selectedProposal.key] ?? selectedProposal.variants) : []

  function updateVariant(idx: number, patch: Partial<ProposedVariant>) {
    if (!selectedProposal) return
    const next = activeVariants.map((v, i) => (i === idx ? { ...v, ...patch } : (patch.isDefault ? { ...v, isDefault: false } : v)))
    setEditedVariants((prev) => ({ ...prev, [selectedProposal.key]: next }))
  }

  function toggleRowExcluded(rowId: string) {
    setExcludedRowIds((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  function handleAccept() {
    if (!selectedProposal) return
    const includedIdx = selectedProposal.variants
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => !excludedRowIds.has(v.sourceRowId))
    if (includedIdx.length === 0) { setMessage('All rows in this family are unchecked — nothing to accept.'); return }

    const variants = includedIdx.map(({ i }) => activeVariants[i])
    const sourceRowIds = includedIdx.map(({ v }) => v.sourceRowId)
    // Legacy pricing fields seeded from the default variant's source row
    // (or the first included row if no default survives exclusion).
    const seedRow = rows.find((r) => r.id === (variants.find((v) => v.isDefault)?.sourceRowId ?? sourceRowIds[0]))

    startTransition(async () => {
      const result = await acceptSubstrateProposal({
        orgId, orgSlug,
        familyName: selectedProposal.familyName,
        materialTypeId: selectedProposal.materialTypeId,
        categoryId: selectedProposal.categoryId,
        sourceRowIds,
        variants: variants.map((v) => ({
          height: v.height, width: v.width, lengthIncrement: v.lengthIncrement, isDefault: v.isDefault,
          baseCost: seedRow?.sheet_cost ?? seedRow?.cost ?? null,
          multiplier: seedRow?.multiplier ?? null,
        })),
        vendorSeed: selectedProposal.vendorSeed
          ? { vendorName: selectedProposal.vendorSeed.vendorName, vendorPrice: selectedProposal.vendorSeed.vendorPrice, partNumber: selectedProposal.vendorSeed.partNumber, rank: selectedProposal.vendorSeed.rank }
          : null,
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
        setMessage(`Created material "${selectedProposal.familyName}".`)
        setSelectedKey(null)
        setExcludedRowIds(new Set())
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
        <p className="mt-1 text-sm text-gray-500">Substrates only. Left is the read-only ShopVOX scrape. Right is a pre-filled proposal — nothing is written to PrintOS until you accept it.</p>
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
          {/* LEFT: read-only ShopVOX scrape, checkboxes to tick items off */}
          <div className="rounded-md border border-gray-200">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium uppercase text-gray-500">ShopVOX scrape ({rowsByStatus.NEW.length})</div>
            <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-100">
              {proposals.map((p) => (
                <div key={p.key} className={`px-3 py-2 ${selectedKey === p.key ? 'bg-blue-50' : ''}`}>
                  <button className="flex w-full items-center justify-between text-left" onClick={() => setSelectedKey(p.key)}>
                    <span className="text-sm font-medium text-gray-900">{p.familyName}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${CONFIDENCE_STYLE[p.confidence]}`}>{p.confidence}</span>
                  </button>
                  <div className="mt-1 space-y-1 pl-2">
                    {p.variants.map((v) => (
                      <label key={v.sourceRowId} className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={!excludedRowIds.has(v.sourceRowId)}
                          onChange={() => toggleRowExcluded(v.sourceRowId)}
                        />
                        <span className={excludedRowIds.has(v.sourceRowId) ? 'line-through text-gray-400' : ''}>{v.sourceName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {proposals.length === 0 && <div className="p-4 text-sm text-gray-500">Nothing new to migrate.</div>}
            </div>
          </div>

          {/* RIGHT: pre-filled proposal */}
          <div className="rounded-md border border-gray-200">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium uppercase text-gray-500">Proposal</div>
            {!selectedProposal ? (
              <div className="p-4 text-sm text-gray-500">Select a family on the left.</div>
            ) : (
              <div className="space-y-3 p-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500">Material name</label>
                  <div className="text-sm font-semibold text-gray-900">{selectedProposal.familyName}</div>
                </div>
                <div className={`rounded border px-2 py-1.5 text-xs ${CONFIDENCE_STYLE[selectedProposal.confidence]}`}>
                  <span className="font-semibold uppercase">{selectedProposal.confidence} confidence</span> — {selectedProposal.reasoning}
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium text-gray-500">Variants</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="pb-1">Default</th><th>Height</th><th>Width</th><th>Length incr.</th><th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeVariants.map((v, i) => (
                        <tr key={v.sourceRowId} className={excludedRowIds.has(v.sourceRowId) ? 'opacity-40' : ''}>
                          <td><input type="radio" name="default-variant" checked={v.isDefault} onChange={() => updateVariant(i, { isDefault: true })} /></td>
                          <td><input type="number" className="w-16 rounded border border-gray-300 px-1 py-0.5" value={v.height ?? ''} onChange={(e) => updateVariant(i, { height: e.target.value === '' ? null : parseFloat(e.target.value) })} /></td>
                          <td><input type="number" className="w-16 rounded border border-gray-300 px-1 py-0.5" value={v.width ?? ''} onChange={(e) => updateVariant(i, { width: e.target.value === '' ? null : parseFloat(e.target.value) })} /></td>
                          <td><input type="number" className="w-16 rounded border border-gray-300 px-1 py-0.5" value={v.lengthIncrement ?? ''} onChange={(e) => updateVariant(i, { lengthIncrement: e.target.value === '' ? null : parseFloat(e.target.value) })} /></td>
                          <td className="max-w-[160px] truncate text-gray-500" title={v.sourceName}>{v.sourceName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedProposal.vendorSeed && (
                  <div className="text-xs text-gray-600">
                    <span className="font-medium text-gray-500">Vendor seed:</span> {selectedProposal.vendorSeed.vendorName}
                    {selectedProposal.vendorSeed.vendorPrice != null && ` — $${selectedProposal.vendorSeed.vendorPrice}`}
                    {selectedProposal.vendorSeed.partNumber && ` (#${selectedProposal.vendorSeed.partNumber})`}
                  </div>
                )}

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
                    onClick={() => { setSelectedKey(null); setExcludedRowIds(new Set()) }}
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

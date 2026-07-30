'use client'

import { useRef, useState } from 'react'
import { parseCsv } from '@/lib/csv-parse'
import { validateTierShape, checkNoOverlap, type TierRange } from '@/lib/pricing-tiers'

export type PricingTier = {
  id: string
  material_id: string
  from_qty: number
  to_qty: number | null
  cost: number
  price: number
}

type Props = {
  materialId: string
  initialTiers: PricingTier[]
}

const fmtMoney = (n: number) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtQty = (n: number) => Number(n).toLocaleString('en-US')

function sortTiers(tiers: PricingTier[]) {
  return [...tiers].sort((a, b) => a.from_qty - b.from_qty)
}

type ImportRow = { from_qty: number; to_qty: number | null; cost: number; price: number }

type Draft = { from: string; to: string; cost: string; price: string }
const emptyDraft = (): Draft => ({ from: '', to: '', cost: '', price: '' })

function draftToPayload(d: Draft) {
  return {
    from_qty: d.from.trim(),
    to_qty: d.to.trim() === '' ? null : d.to.trim(),
    cost: d.cost.trim(),
    price: d.price.trim(),
  }
}

export default function PricingMatrixSection({ materialId, initialTiers }: Props) {
  const [tiers, setTiers] = useState<PricingTier[]>(sortTiers(initialTiers))

  const [showAddRow, setShowAddRow] = useState(false)
  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft())
  const [addError, setAddError] = useState<string | null>(null)
  const [addingTier, setAddingTier] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft())
  const [editError, setEditError] = useState<string | null>(null)
  const [savingTier, setSavingTier] = useState(false)

  const [toast, setToast] = useState<string | null>(null)
  const [pendingImportRows, setPendingImportRows] = useState<ImportRow[] | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const startAdd = () => {
    setAddDraft(emptyDraft())
    setAddError(null)
    setShowAddRow(true)
  }

  const cancelAdd = () => {
    setShowAddRow(false)
    setAddDraft(emptyDraft())
    setAddError(null)
  }

  const handleAdd = async () => {
    const payload = draftToPayload(addDraft)
    const shapeError = validateTierShape(payload)
    if (shapeError) { setAddError(shapeError); return }
    const from_qty = Number(payload.from_qty)
    const to_qty = payload.to_qty === null ? null : Number(payload.to_qty)
    const overlapError = checkNoOverlap({ from_qty, to_qty }, tiers)
    if (overlapError) { setAddError(overlapError); return }

    setAddingTier(true)
    setAddError(null)
    const res = await fetch(`/api/materials/${materialId}/pricing-tiers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const newTier = await res.json()
      setTiers((prev) => sortTiers([...prev, newTier]))
      cancelAdd()
      showToast('Tier added')
    } else {
      const body = await res.json().catch(() => ({}))
      setAddError(body.error ?? 'Failed to add tier')
    }
    setAddingTier(false)
  }

  const startEdit = (t: PricingTier) => {
    setEditingId(t.id)
    setEditDraft({ from: String(t.from_qty), to: t.to_qty == null ? '' : String(t.to_qty), cost: String(t.cost), price: String(t.price) })
    setEditError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError(null)
  }

  const handleSaveEdit = async (tierId: string) => {
    const payload = draftToPayload(editDraft)
    const shapeError = validateTierShape(payload)
    if (shapeError) { setEditError(shapeError); return }
    const from_qty = Number(payload.from_qty)
    const to_qty = payload.to_qty === null ? null : Number(payload.to_qty)
    const others = tiers.filter((t) => t.id !== tierId)
    const overlapError = checkNoOverlap({ from_qty, to_qty }, others)
    if (overlapError) { setEditError(overlapError); return }

    setSavingTier(true)
    setEditError(null)
    const res = await fetch(`/api/materials/${materialId}/pricing-tiers/${tierId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const updated = await res.json()
      setTiers((prev) => sortTiers(prev.map((t) => (t.id === tierId ? updated : t))))
      cancelEdit()
      showToast('Tier updated')
    } else {
      const body = await res.json().catch(() => ({}))
      setEditError(body.error ?? 'Failed to save tier')
    }
    setSavingTier(false)
  }

  const handleDelete = async (tierId: string) => {
    const res = await fetch(`/api/materials/${materialId}/pricing-tiers/${tierId}`, { method: 'DELETE' })
    if (res.ok) {
      setTiers((prev) => prev.filter((t) => t.id !== tierId))
      showToast('Tier deleted')
    } else {
      showToast('Failed to delete tier')
    }
  }

  // ── CSV import ──────────────────────────────────────────────────────────
  const parseImportFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const allRows = parseCsv(text)
      if (allRows.length < 2) { setImportError('CSV is empty or has no data rows.'); return }
      const dataRows = allRows.slice(1) // drop header row
      const parsed: ImportRow[] = []
      const seen: TierRange[] = []
      for (let i = 0; i < dataRows.length; i++) {
        const [fromRaw, toRaw, costRaw, priceRaw] = dataRows[i]
        const row = { from_qty: fromRaw ?? '', to_qty: (toRaw ?? '').trim() === '' ? null : toRaw, cost: costRaw ?? '', price: priceRaw ?? '' }
        const shapeError = validateTierShape(row)
        if (shapeError) { setImportError(`Row ${i + 2}: ${shapeError}`); return }
        const from_qty = Number(row.from_qty)
        const to_qty = row.to_qty === null ? null : Number(row.to_qty)
        const overlapError = checkNoOverlap({ from_qty, to_qty }, seen)
        if (overlapError) { setImportError(`Row ${i + 2}: ${overlapError}`); return }
        seen.push({ from_qty, to_qty })
        parsed.push({ from_qty, to_qty, cost: Number(row.cost), price: Number(row.price) })
      }
      setImportError(null)
      // Nothing to replace — import immediately without a confirmation.
      if (tiers.length === 0) { runImport(parsed); return }
      setPendingImportRows(parsed)
    }
    reader.readAsText(file)
  }

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) { setImportError('Please pick a .csv file.'); return }
    setImportError(null)
    parseImportFile(file)
  }

  const runImport = async (rows: ImportRow[]) => {
    setImporting(true)
    const res = await fetch(`/api/materials/${materialId}/pricing-tiers/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    })
    if (res.ok) {
      const data = await res.json()
      setTiers(sortTiers(data))
      setPendingImportRows(null)
      showToast(`Imported ${data.length} tier${data.length === 1 ? '' : 's'}`)
    } else {
      const body = await res.json().catch(() => ({}))
      setImportError(body.error ?? 'Import failed')
      setPendingImportRows(null)
    }
    setImporting(false)
  }

  const cellInputCls = 'w-full rounded border border-gray-300 px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-qm-lime'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:col-span-2">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Pricing Matrix</h2>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFilePicked} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Import Tiers CSV
          </button>
          <a
            href={`/api/materials/${materialId}/pricing-tiers/export`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Export Tiers CSV
          </a>
          <button
            onClick={startAdd}
            className="rounded-md bg-qm-lime px-3 py-1.5 text-xs font-semibold text-white hover:brightness-105"
          >
            + Add Tier
          </button>
        </div>
      </div>

      {importError && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{importError}</div>
      )}

      {(tiers.length > 0 || showAddRow) && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-2 text-right font-semibold text-gray-700 w-24">From Qty</th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700 w-24">To Qty</th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700 w-28">Cost</th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700 w-28">Price</th>
                <th className="px-4 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tiers.map((t) => (
                editingId === t.id ? (
                  <tr key={t.id} className="bg-amber-50">
                    <td className="px-4 py-2">
                      <input type="number" value={editDraft.from} onChange={(e) => setEditDraft({ ...editDraft, from: e.target.value })} className={cellInputCls} min="0" step="1" autoFocus />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" value={editDraft.to} onChange={(e) => setEditDraft({ ...editDraft, to: e.target.value })} placeholder="Open-ended" className={cellInputCls} min="0" step="1" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" value={editDraft.cost} onChange={(e) => setEditDraft({ ...editDraft, cost: e.target.value })} className={cellInputCls} min="0" step="0.01" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" value={editDraft.price} onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })} className={cellInputCls} min="0" step="0.01" />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleSaveEdit(t.id)} disabled={savingTier} className="text-xs font-semibold text-qm-lime hover:opacity-80 disabled:opacity-50">Save</button>
                        <button onClick={cancelEdit} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    </td>
                    {editError && (
                      <td colSpan={5} className="px-4 pb-2 pt-0 text-xs text-red-600">{editError}</td>
                    )}
                  </tr>
                ) : (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{fmtQty(t.from_qty)}</td>
                    <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{t.to_qty == null ? '+' : fmtQty(t.to_qty)}</td>
                    <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{fmtMoney(t.cost)}</td>
                    <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{fmtMoney(t.price)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => startEdit(t)} className="text-gray-400 hover:text-gray-700">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
                          </svg>
                        </button>
                        <button onClick={() => handleDelete(t.id)} className="text-gray-300 hover:text-red-500">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}

              {showAddRow && (
                <tr className="bg-green-50">
                  <td className="px-4 py-2">
                    <input type="number" value={addDraft.from} onChange={(e) => setAddDraft({ ...addDraft, from: e.target.value })} className={cellInputCls} min="0" step="1" placeholder="1" autoFocus />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" value={addDraft.to} onChange={(e) => setAddDraft({ ...addDraft, to: e.target.value })} placeholder="Open-ended" className={cellInputCls} min="0" step="1" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" value={addDraft.cost} onChange={(e) => setAddDraft({ ...addDraft, cost: e.target.value })} className={cellInputCls} min="0" step="0.01" placeholder="0.00" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" value={addDraft.price} onChange={(e) => setAddDraft({ ...addDraft, price: e.target.value })} className={cellInputCls} min="0" step="0.01" placeholder="0.00" />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={handleAdd} disabled={addingTier} className="text-xs font-semibold text-qm-lime hover:opacity-80 disabled:opacity-50">
                        {addingTier ? '…' : 'Add'}
                      </button>
                      <button onClick={cancelAdd} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>
                  </td>
                  {addError && (
                    <td colSpan={5} className="px-4 pb-2 pt-0 text-xs text-red-600">{addError}</td>
                  )}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Import replace confirmation */}
      {pendingImportRows !== null && tiers.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { if (!importing) setPendingImportRows(null) }} />
          <div className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-bold text-gray-900">Replace Pricing Tiers?</h2>
            <p className="mb-5 text-sm text-gray-500">
              This will replace {tiers.length} existing tier{tiers.length === 1 ? '' : 's'} with {pendingImportRows.length} imported tier{pendingImportRows.length === 1 ? '' : 's'}. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setPendingImportRows(null)} disabled={importing} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button
                onClick={() => runImport(pendingImportRows)}
                disabled={importing}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {importing ? 'Replacing…' : 'Replace'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-green-800">{toast}</span>
        </div>
      )}
    </div>
  )
}

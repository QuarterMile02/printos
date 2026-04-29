'use client'

import { useMemo, useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { parseCsv } from '@/lib/csv-parse'
import {
  resolveHeaders, buildRow, buildHeaderMappingPreview,
  type MaterialImportRow,
} from '@/lib/material-import-mapper'
import {
  importMaterialsBatch, revalidateMaterialsList,
  detectMaterialConflicts, applyMaterialImport,
  type ImportBatchResult, type MaterialConflict, type ImportDecision,
} from './actions'
import ImportConflictModal, { type ConflictRow } from '@/components/import-conflict-modal'

const BATCH_SIZE = 50

type Phase = 'pick' | 'preview' | 'importing' | 'done'

type ParseState = {
  fileName: string
  headerRow: string[]
  dataRows: string[][]
  rows: MaterialImportRow[]
  unmappedHeaders: string[]
}

export default function ImportClient({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('pick')
  const [parsed, setParsed] = useState<ParseState | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Import progress state
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState<ImportBatchResult | null>(null)
  const [isPending, startTransition] = useTransition()

  // Conflict-modal state. Set when detectMaterialConflicts returns
  // matches; cleared after the user resolves or cancels. cleanRows /
  // conflictRowMap / fieldDefs are stashed here so applyMaterialImport
  // can be called with the same payload after resolution.
  const [conflictModal, setConflictModal] = useState<{
    conflicts: ConflictRow[]
    cleanRows: MaterialImportRow[]
    conflictRowMap: Record<string, MaterialImportRow>
  } | null>(null)

  const previewRows = useMemo(() => parsed?.rows.slice(0, 10) ?? [], [parsed])
  const mappingPreview = useMemo(
    () => (parsed ? buildHeaderMappingPreview(parsed.headerRow) : []),
    [parsed],
  )

  // ── File handling ────────────────────────────────────────────────────────
  function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setParseError('Please pick a .csv file.')
      return
    }
    setParseError(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = reader.result as string
        const all = parseCsv(text)
        if (all.length < 2) {
          setParseError('CSV is empty or has no data rows.')
          return
        }
        const headerRow = all[0]
        const dataRows = all.slice(1)
        const { index, unmappedHeaders } = resolveHeaders(headerRow)
        const rows = dataRows.map((r) => buildRow(index, r))
        setParsed({ fileName: file.name, headerRow, dataRows, rows, unmappedHeaders })
        setPhase('preview')
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Failed to parse CSV.')
      }
    }
    reader.onerror = () => setParseError('Could not read file.')
    reader.readAsText(file)
  }

  function onPickClick() { fileInputRef.current?.click() }
  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }
  function reset() {
    setParsed(null)
    setSummary(null)
    setProgress({ done: 0, total: 0 })
    setPhase('pick')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Import ───────────────────────────────────────────────────────────────
  // Two-step flow:
  //   1. Detect conflicts up front. If any names already exist, open
  //      the modal and let the user pick Skip / Replace / Keep Both.
  //   2. After resolution (or immediately, if no conflicts), apply.
  function startImport() {
    if (!parsed) return
    setPhase('importing')
    setProgress({ done: 0, total: parsed.rows.length })

    startTransition(async () => {
      const detect = await detectMaterialConflicts(orgId, parsed.rows)
      if (detect.error) {
        setSummary({ imported: 0, replaced: 0, skipped: 0, errors: [{ row: 0, name: '(detect)', message: detect.error }] })
        setPhase('done')
        return
      }

      const conflicts = detect.conflicts ?? []
      const cleanRows = detect.cleanRows ?? []
      const conflictRowMap = detect.conflictRowMap ?? {}
      const diffFields = detect.diffFields ?? []

      // No conflicts → straight to apply with empty decisions.
      if (conflicts.length === 0) {
        await runApply(cleanRows, conflictRowMap, {})
        return
      }

      // Open modal. runApply is invoked from onResolve after user decides.
      const modalRows: ConflictRow[] = conflicts.map((c: MaterialConflict) => ({
        conflict_key: c.conflict_key,
        display_name: c.display_name,
        fields: diffFields.map((f) => ({
          label: f.label,
          existing: c.existing[f.key] ?? null,
          incoming: c.incoming[f.key] ?? null,
        })),
      }))
      setConflictModal({ conflicts: modalRows, cleanRows, conflictRowMap })
    })
  }

  async function runApply(
    cleanRows: MaterialImportRow[],
    conflictRowMap: Record<string, MaterialImportRow>,
    decisions: Record<string, ImportDecision>,
  ) {
    const aggregate: ImportBatchResult = { imported: 0, replaced: 0, skipped: 0, errors: [] }
    setProgress({ done: 0, total: cleanRows.length + Object.keys(decisions).length })

    // Path A: only clean rows + zero conflict decisions → keep batched
    // path (handles big CSVs well).
    if (Object.keys(decisions).length === 0) {
      for (let start = 0; start < cleanRows.length; start += BATCH_SIZE) {
        const batch = cleanRows.slice(start, start + BATCH_SIZE)
        const csvRowOfFirst = start + 2
        const res = await importMaterialsBatch(orgId, orgSlug, batch, csvRowOfFirst)
        if (res.error) {
          aggregate.errors.push({ row: csvRowOfFirst, name: '(batch)', message: res.error })
        } else if (res.result) {
          aggregate.imported += res.result.imported
          aggregate.skipped += res.result.skipped
          aggregate.errors.push(...res.result.errors)
        }
        setProgress({ done: Math.min(start + batch.length, cleanRows.length), total: cleanRows.length })
      }
    } else {
      // Path B: applyMaterialImport handles inserts + updates + renames
      // in one round-trip. Used whenever conflicts were resolved.
      const res = await applyMaterialImport(orgId, orgSlug, cleanRows, conflictRowMap, decisions)
      if (res.error) {
        aggregate.errors.push({ row: 0, name: '(apply)', message: res.error })
      } else if (res.result) {
        aggregate.imported += res.result.imported
        aggregate.replaced += res.result.replaced
        aggregate.skipped += res.result.skipped
        aggregate.errors.push(...res.result.errors)
      }
      setProgress({ done: aggregate.imported + aggregate.replaced + aggregate.skipped, total: cleanRows.length + Object.keys(decisions).length })
    }

    await revalidateMaterialsList(orgSlug)
    setSummary(aggregate)
    setPhase('done')
  }

  function onResolveConflicts(decisions: Record<string, ImportDecision>) {
    if (!conflictModal) return
    const { cleanRows, conflictRowMap } = conflictModal
    setConflictModal(null)
    startTransition(async () => {
      await runApply(cleanRows, conflictRowMap, decisions)
    })
  }

  function onCancelConflicts() {
    setConflictModal(null)
    setPhase('preview')
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${orgSlug}/settings/materials`} className="hover:text-gray-700">Materials</Link>
        <span>/</span>
        <span className="text-gray-700">Import CSV</span>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-qm-black">Import Materials</h1>
          <p className="text-sm text-qm-gray mt-1">
            Upload a ShopVOX <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">Material Export List</code> CSV.
            Duplicates (matching name, case-insensitive) are skipped.
          </p>
        </div>
      </div>

      {/* Phase: pick file */}
      {phase === 'pick' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
            dragging ? 'border-qm-lime bg-qm-lime-light/30' : 'border-gray-300 bg-gray-50'
          }`}
        >
          <svg className="mx-auto h-10 w-10 text-qm-gray" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          <p className="mt-3 text-sm font-medium text-qm-black">
            Drag &amp; drop a CSV file here, or{' '}
            <button type="button" onClick={onPickClick} className="text-qm-lime font-semibold hover:underline">
              click to pick
            </button>
          </p>
          <p className="mt-1 text-xs text-qm-gray">.csv files only</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onFileInput}
          />
          {parseError && (
            <p className="mt-4 inline-block rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{parseError}</p>
          )}
        </div>
      )}

      {/* Phase: preview */}
      {phase === 'preview' && parsed && (
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-qm-gray">File</p>
                <p className="text-sm font-semibold text-qm-black">{parsed.fileName}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-qm-gray">Rows</p>
                <p className="text-2xl font-extrabold text-qm-black">{parsed.rows.length.toLocaleString()}</p>
              </div>
            </div>
            {parsed.unmappedHeaders.length > 0 && (
              <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <span className="font-semibold">Unmapped columns (will be ignored):</span>{' '}
                {parsed.unmappedHeaders.join(', ')}
              </div>
            )}
          </div>

          {/* Column mapping table */}
          <div>
            <h2 className="text-base font-bold text-qm-black mb-2">Column Mapping</h2>
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">CSV Column</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">→</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Database Field</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {mappingPreview.map((m, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-sm text-qm-black">{m.csvHeader || <em className="text-qm-gray">(blank)</em>}</td>
                      <td className="px-3 py-1.5 text-xs text-qm-gray">→</td>
                      <td className="px-3 py-1.5 text-sm">
                        {m.dbColumn === null ? (
                          <span className="text-amber-700 italic">unmapped</span>
                        ) : m.dbColumn === '(ignored)' ? (
                          <span className="text-qm-gray italic">ignored</span>
                        ) : (
                          <code className="rounded bg-qm-lime-light px-1.5 py-0.5 text-xs font-semibold text-qm-lime-dark">{m.dbColumn}</code>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* First 10 rows preview */}
          <div>
            <h2 className="text-base font-bold text-qm-black mb-2">Preview — first 10 rows</h2>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Category</th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Cost</th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Price</th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Mult</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Buy Units</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Sell Units</th>
                    <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {previewRows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-sm text-qm-black max-w-xs truncate" title={r.name}>{r.name}</td>
                      <td className="px-3 py-1.5 text-sm text-qm-gray">{r.type_name ?? '—'}</td>
                      <td className="px-3 py-1.5 text-sm text-qm-gray">{r.category_name ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right text-sm tabular-nums">${r.cost.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right text-sm tabular-nums">${r.price.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right text-sm tabular-nums">{r.multiplier}</td>
                      <td className="px-3 py-1.5 text-sm text-qm-gray">{r.buying_units ?? '—'}</td>
                      <td className="px-3 py-1.5 text-sm text-qm-gray">{r.selling_units ?? '—'}</td>
                      <td className="px-3 py-1.5 text-center text-sm">{r.active ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={startImport}
              disabled={isPending}
              className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              Import {parsed.rows.length.toLocaleString()} materials
            </button>
          </div>
        </div>
      )}

      {/* Phase: importing — progress bar */}
      {phase === 'importing' && (
        <div className="rounded-xl border border-gray-200 bg-white p-8">
          <p className="text-sm font-semibold text-qm-black">Importing materials…</p>
          <p className="mt-1 text-xs text-qm-gray">
            {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows processed
          </p>
          <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full bg-qm-lime transition-all"
              style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Phase: done — summary */}
      {phase === 'done' && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-green-700">Added</p>
              <p className="mt-1 text-3xl font-extrabold text-green-800">{summary.imported.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Replaced</p>
              <p className="mt-1 text-3xl font-extrabold text-amber-800">{summary.replaced.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-600">Skipped</p>
              <p className="mt-1 text-3xl font-extrabold text-gray-700">{summary.skipped.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center">
              <p className="text-xs font-bold uppercase tracking-wider text-red-700">Errors</p>
              <p className="mt-1 text-3xl font-extrabold text-red-800">{summary.errors.length.toLocaleString()}</p>
            </div>
          </div>

          {summary.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-white">
              <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-red-700">
                Errors
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">CSV Row</th>
                      <th className="px-3 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                      <th className="px-3 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summary.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1 text-xs tabular-nums text-qm-gray">{e.row}</td>
                        <td className="px-3 py-1 text-sm text-qm-black">{e.name}</td>
                        <td className="px-3 py-1 text-xs text-red-700">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={reset} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
              Import another
            </button>
            <button
              type="button"
              onClick={() => router.push(`/dashboard/${orgSlug}/settings/materials`)}
              className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110"
            >
              Back to Materials
            </button>
          </div>
        </div>
      )}

      <ImportConflictModal
        open={conflictModal !== null}
        conflicts={conflictModal?.conflicts ?? []}
        entityLabel="material"
        onCancel={onCancelConflicts}
        onResolve={onResolveConflicts}
      />
    </>
  )
}

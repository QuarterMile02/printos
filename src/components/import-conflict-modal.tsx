'use client'

// Generic side-by-side conflict-resolution modal for CSV / bulk imports.
// One row per conflict. User picks Skip / Replace / Keep Both per row,
// or chooses one decision and ticks "Apply to all". Diff highlights any
// field where existing.value !== incoming.value in amber.
//
// The modal is entity-agnostic — caller passes the field labels and the
// existing/incoming dictionaries; modal renders the diff. Decisions are
// returned to the caller, which is responsible for applying them via a
// server action.

import { useMemo, useState } from 'react'

export type ImportDecision = 'skip' | 'replace' | 'keep_both'

export type ConflictRow = {
  // Stable key for React + decision tracking. For DB-existing rows, this
  // is usually the existing record's UUID. For pure intra-batch dupes,
  // any unique string works.
  conflict_key: string
  // Display name shown as the row header.
  display_name: string
  // Field-by-field diff. Order is the visual order in the modal.
  fields: { label: string; existing: string | number | null; incoming: string | number | null }[]
}

type Props = {
  open: boolean
  conflicts: ConflictRow[]
  entityLabel: string  // "material" / "labor rate" / "machine rate" / "product"
  onCancel: () => void
  onResolve: (decisions: Record<string, ImportDecision>) => void
}

function formatValue(v: string | number | null): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  return v.trim() || '—'
}

function valuesEqual(a: string | number | null, b: string | number | null): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

export default function ImportConflictModal({
  open, conflicts, entityLabel, onCancel, onResolve,
}: Props) {
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>(
    () => Object.fromEntries(conflicts.map((c) => [c.conflict_key, 'skip' as ImportDecision])),
  )
  const [bulkDecision, setBulkDecision] = useState<ImportDecision | ''>('')
  const [applyToAll, setApplyToAll] = useState(false)

  const decisionsToSubmit = useMemo<Record<string, ImportDecision>>(() => {
    if (applyToAll && bulkDecision) {
      return Object.fromEntries(conflicts.map((c) => [c.conflict_key, bulkDecision]))
    }
    return decisions
  }, [applyToAll, bulkDecision, conflicts, decisions])

  if (!open) return null

  const counts = {
    skip: Object.values(decisionsToSubmit).filter((d) => d === 'skip').length,
    replace: Object.values(decisionsToSubmit).filter((d) => d === 'replace').length,
    keep_both: Object.values(decisionsToSubmit).filter((d) => d === 'keep_both').length,
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-[#1A1A1A]">
              {conflicts.length} {entityLabel}{conflicts.length === 1 ? '' : 's'} already exist{conflicts.length === 1 ? 's' : ''}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Pick what to do with each conflict. Differences from your existing data are highlighted in amber.
            </p>
          </div>
          <button onClick={onCancel} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Cancel">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Apply to all bar */}
        <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-6 py-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="h-4 w-4 accent-[#93ca3b]"
            />
            <span className="font-semibold">Apply to all conflicts</span>
          </label>
          <select
            value={bulkDecision}
            onChange={(e) => setBulkDecision(e.target.value as ImportDecision | '')}
            disabled={!applyToAll}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
          >
            <option value="">— pick action —</option>
            <option value="skip">Skip all (keep existing)</option>
            <option value="replace">Replace all (overwrite existing)</option>
            <option value="keep_both">Keep both (append &quot; (Import)&quot; to incoming)</option>
          </select>
          <span className="ml-auto text-xs text-gray-500 tabular-nums">
            <span className="text-gray-600">Skip {counts.skip}</span>
            <span className="mx-2 text-gray-300">|</span>
            <span className="text-amber-700">Replace {counts.replace}</span>
            <span className="mx-2 text-gray-300">|</span>
            <span className="text-[#93ca3b]">Keep Both {counts.keep_both}</span>
          </span>
        </div>

        {/* Conflicts list — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            {conflicts.map((c) => {
              const effective = applyToAll && bulkDecision ? bulkDecision : decisions[c.conflict_key]
              return (
                <div key={c.conflict_key} className="rounded-lg border border-gray-200 bg-white">
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
                    <h3 className="text-sm font-bold text-[#1A1A1A]">{c.display_name}</h3>
                    <div className="flex gap-1">
                      {(['skip', 'replace', 'keep_both'] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDecisions((prev) => ({ ...prev, [c.conflict_key]: d }))}
                          disabled={applyToAll && !!bulkDecision}
                          className={`rounded-md px-3 py-1 text-xs font-semibold ${
                            effective === d
                              ? d === 'skip'
                                ? 'bg-gray-700 text-white'
                                : d === 'replace'
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-[#93ca3b] text-white'
                              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                          } ${applyToAll && !!bulkDecision ? 'opacity-60' : ''}`}
                        >
                          {d === 'skip' ? 'Skip' : d === 'replace' ? 'Replace' : 'Keep Both'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_1fr] gap-px bg-gray-100">
                    <div className="bg-gray-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Existing</div>
                    <div className="bg-gray-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">Incoming</div>
                    {c.fields.map((f, i) => {
                      const changed = !valuesEqual(f.existing, f.incoming)
                      const cellCls = changed
                        ? 'bg-amber-50 px-3 py-1.5 text-xs text-amber-900'
                        : 'bg-white px-3 py-1.5 text-xs text-gray-700'
                      return (
                        <>
                          <div key={`l-${i}`} className={cellCls}>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{f.label}</span>
                            <div className="font-medium tabular-nums">{formatValue(f.existing)}</div>
                          </div>
                          <div key={`r-${i}`} className={cellCls}>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{f.label}</span>
                            <div className="font-medium tabular-nums">{formatValue(f.incoming)}</div>
                          </div>
                        </>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel import
          </button>
          <button
            type="button"
            onClick={() => onResolve(decisionsToSubmit)}
            disabled={applyToAll && !bulkDecision}
            className="rounded-md bg-[#93ca3b] px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            Apply decisions ({conflicts.length})
          </button>
        </div>
      </div>
    </div>
  )
}

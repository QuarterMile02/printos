'use client'

import { useState, useRef, useEffect } from 'react'
import type { ColumnMeta, FilterRule, SavedView } from './types'
import type { CreateViewParams } from './use-saved-view'
import { FilterBuilder } from './filter-builder'
import { ViewsDropdown } from './views-dropdown'

interface Props {
  columns: ColumnMeta[]
  filterRules: FilterRule[]
  onFilterRulesChange: (rules: FilterRule[]) => void
  activeView: SavedView | null
  myViews: SavedView[]
  sharedViews: SavedView[]
  isDirty: boolean
  isViewReadOnly: boolean
  viewsLoading: boolean
  currentUserId: string
  onLoadView: (view: SavedView | null) => void
  onSaveView: () => Promise<{ error?: string } | void>
  onCreateView: (params: CreateViewParams) => Promise<{ error?: string }>
  onDeleteView: (id: string) => Promise<{ error?: string }>
}

export function DataTableToolbar({
  columns,
  filterRules,
  onFilterRulesChange,
  activeView,
  myViews,
  sharedViews,
  isDirty,
  isViewReadOnly,
  viewsLoading,
  currentUserId,
  onLoadView,
  onSaveView,
  onCreateView,
  onDeleteView,
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const activeCount = filterRules.length

  useEffect(() => {
    if (!filtersOpen) return
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setFiltersOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [filtersOpen])

  return (
    <div className="flex items-center gap-2">
      {/* ── Filters button ── */}
      <div className="relative">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
            filtersOpen || activeCount > 0
              ? 'border-qm-lime bg-qm-lime-light text-qm-lime-dark'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {/* funnel icon */}
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-qm-lime text-[10px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </button>

        {filtersOpen && (
          <div
            ref={panelRef}
            className="absolute right-0 top-full z-50 mt-1 w-[520px] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800">
                Filters
                {activeCount > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400">
                    ({activeCount} active)
                  </span>
                )}
              </span>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={() => onFilterRulesChange([])}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear all
                </button>
              )}
            </div>

            <FilterBuilder
              columns={columns}
              rules={filterRules}
              onChange={onFilterRulesChange}
              disabled={isViewReadOnly}
            />

            {isViewReadOnly && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                This is a locked view — switch to a Personal or Collaborative view to edit filters.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Views dropdown ── */}
      <ViewsDropdown
        activeView={activeView}
        myViews={myViews}
        sharedViews={sharedViews}
        isDirty={isDirty}
        isViewReadOnly={isViewReadOnly}
        loading={viewsLoading}
        currentUserId={currentUserId}
        onLoad={onLoadView}
        onSave={onSaveView}
        onCreate={onCreateView}
        onDelete={onDeleteView}
      />
    </div>
  )
}

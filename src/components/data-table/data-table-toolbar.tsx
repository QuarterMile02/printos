'use client'

import { createPortal } from 'react-dom'
import type { ColumnMeta, FilterRule, SavedView, ViewMode } from './types'
import type { CreateViewParams } from './use-saved-view'
import { FilterBuilder } from './filter-builder'
import { ViewsDropdown } from './views-dropdown'
import { usePortalPanel } from './use-portal-panel'

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
  viewMode?: ViewMode
  onViewModeChange?: (mode: ViewMode) => void
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
  viewMode,
  onViewModeChange,
}: Props) {
  const {
    open: filtersOpen,
    setOpen: setFiltersOpen,
    mounted,
    triggerRef: btnRef,
    panelRef,
    pos,
  } = usePortalPanel()

  const activeCount = filterRules.length

  return (
    <div className="flex items-center gap-2">
      {/* ── View mode toggle — only rendered when card renderer is wired up ── */}
      {onViewModeChange && (
        <div className="flex overflow-hidden rounded-md border border-gray-300">
          <button
            type="button"
            onClick={() => onViewModeChange('list')}
            title="List view"
            className={`flex items-center px-2.5 py-2 transition-colors ${
              (viewMode ?? 'list') === 'list'
                ? 'bg-qm-lime-light text-qm-lime-dark'
                : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            {/* rows / list icon */}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('card')}
            title="Card view"
            className={`flex items-center border-l border-gray-300 px-2.5 py-2 transition-colors ${
              viewMode === 'card'
                ? 'bg-qm-lime-light text-qm-lime-dark'
                : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            {/* grid / cards icon */}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Filters button ── */}
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

      {/* ── Filter panel — portaled to document.body so no ancestor overflow clips it ── */}
      {mounted && filtersOpen && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="w-[520px] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
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
        </div>,
        document.body
      )}

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

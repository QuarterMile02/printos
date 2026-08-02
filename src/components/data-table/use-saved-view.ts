'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient as _createClient } from '@/lib/supabase/client'
import type { ColumnDef, FilterRule, FilterOperator, SavedView, SortRule, ViewMode } from './types'

// saved_views is added via manual migration after DB type generation,
// so we bypass Supabase's generated types here to avoid 'never' errors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sv() { return (_createClient() as any).from('saved_views') }

export interface CreateViewParams {
  name: string
  viewType: 'personal' | 'collaborative' | 'locked'
  sharedWithRoles: string[]
  sharedWithUserIds: string[]
}

interface Options {
  tableKey: string
  orgId: string
  userId: string
  userRole: string
}

export function useSavedView({ tableKey, orgId, userId, userRole }: Options) {
  const [views, setViews] = useState<SavedView[]>([])
  const [viewsLoading, setViewsLoading] = useState(true)
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [sortRules, setSortRules] = useState<SortRule[]>([])
  const [filterRules, setFilterRulesState] = useState<FilterRule[]>([])
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [viewMode, setViewModeState] = useState<ViewMode>('list')

  // snapshot taken when a view is loaded — used to detect unsaved changes
  const savedSnapshot = useRef<{
    sort: SortRule[]
    filters: FilterRule[]
    widths: Record<string, number>
    viewMode: ViewMode
  } | null>(null)

  useEffect(() => {
    if (!orgId || !tableKey) { setViewsLoading(false); return }
    setViewsLoading(true)
    sv()
      .select('*')
      .eq('organization_id', orgId)
      .eq('table_key', tableKey)
      .then(({ data }: { data: SavedView[] | null }) => {
        setViews(data ?? [])
        setViewsLoading(false)
      })
  }, [orgId, tableKey])

  const myViews = views.filter((v) => v.created_by === userId)
  const sharedViews = views.filter(
    (v) =>
      v.created_by !== userId &&
      (v.shared_with_user_ids.includes(userId) ||
        v.shared_with_roles.includes(userRole)),
  )

  const activeView = views.find((v) => v.id === activeViewId) ?? null
  const isViewReadOnly =
    activeView?.view_type === 'locked' && activeView.created_by !== userId

  const isDirty =
    activeView !== null &&
    savedSnapshot.current !== null &&
    (JSON.stringify(sortRules) !== JSON.stringify(savedSnapshot.current.sort) ||
      JSON.stringify(filterRules) !== JSON.stringify(savedSnapshot.current.filters) ||
      JSON.stringify(columnWidths) !== JSON.stringify(savedSnapshot.current.widths) ||
      viewMode !== savedSnapshot.current.viewMode)

  const loadView = useCallback((view: SavedView | null) => {
    if (!view) {
      setActiveViewId(null)
      setSortRules([])
      setFilterRulesState([])
      setColumnWidths({})
      setViewModeState('list')
      savedSnapshot.current = null
      return
    }
    const sort = view.sort_rules ?? []
    const filters = view.filter_rules ?? []
    const widths = view.column_widths ?? {}
    const mode: ViewMode = view.view_mode ?? 'list'
    setActiveViewId(view.id)
    setSortRules(sort)
    setFilterRulesState(filters)
    setColumnWidths(widths)
    setViewModeState(mode)
    savedSnapshot.current = { sort, filters, widths, viewMode: mode }
  }, [])

  const setSort = useCallback(
    (column: string) => {
      if (isViewReadOnly) return
      setSortRules((prev) => {
        const existing = prev.find((r) => r.column === column)
        if (!existing) return [{ column, direction: 'asc' }]
        if (existing.direction === 'asc') return [{ column, direction: 'desc' }]
        return []
      })
    },
    [isViewReadOnly],
  )

  const setFilterRules = useCallback(
    (rules: FilterRule[]) => {
      if (isViewReadOnly) return
      setFilterRulesState(rules)
    },
    [isViewReadOnly],
  )

  const setColumnWidth = useCallback(
    (column: string, width: number) => {
      if (isViewReadOnly) return
      setColumnWidths((prev) => {
        const newWidths = { ...prev, [column]: width }
        if (activeViewId) {
          sv()
            .update({ column_widths: newWidths, updated_at: new Date().toISOString() })
            .eq('id', activeViewId)
            .then(({ error }: { error: { message: string } | null }) => {
              if (error) console.error('[useSavedView] Failed to persist column width:', error.message)
            })
        }
        return newWidths
      })
    },
    [isViewReadOnly, activeViewId],
  )

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
  }, [])

  const saveCurrentView = useCallback(async (): Promise<{ error?: string }> => {
    if (!activeViewId || isViewReadOnly) return { error: 'No editable view' }
    const { error } = await sv()
      .update({
        sort_rules: sortRules,
        filter_rules: filterRules,
        column_widths: columnWidths,
        view_mode: viewMode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activeViewId)
    if (!error) {
      savedSnapshot.current = { sort: sortRules, filters: filterRules, widths: columnWidths, viewMode }
      setViews((prev) =>
        prev.map((v) =>
          v.id === activeViewId
            ? { ...v, sort_rules: sortRules, filter_rules: filterRules, column_widths: columnWidths, view_mode: viewMode }
            : v,
        ),
      )
    }
    return { error: error?.message }
  }, [activeViewId, isViewReadOnly, sortRules, filterRules, columnWidths, viewMode])

  const createView = useCallback(
    async (params: CreateViewParams): Promise<{ error?: string }> => {
      const { data, error } = await sv()
        .insert({
          organization_id: orgId,
          table_key: tableKey,
          name: params.name,
          created_by: userId,
          view_type: params.viewType,
          shared_with_roles: params.sharedWithRoles,
          shared_with_user_ids: params.sharedWithUserIds,
          column_widths: columnWidths,
          column_order: [],
          sort_rules: sortRules,
          filter_rules: filterRules,
          view_mode: viewMode,
        })
        .select()
        .single()
      if (!error && data) {
        const newView = data as SavedView
        setViews((prev) => [...prev, newView])
        setActiveViewId(newView.id)
        savedSnapshot.current = { sort: sortRules, filters: filterRules, widths: columnWidths, viewMode }
      }
      return { error: error?.message }
    },
    [orgId, tableKey, userId, columnWidths, sortRules, filterRules, viewMode],
  )

  const deleteView = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const { error } = await sv().delete().eq('id', id)
      if (!error) {
        setViews((prev) => prev.filter((v) => v.id !== id))
        if (activeViewId === id) {
          setActiveViewId(null)
          setSortRules([])
          setFilterRulesState([])
          setColumnWidths({})
          setViewModeState('list')
          savedSnapshot.current = null
        }
      }
      return { error: error?.message }
    },
    [activeViewId],
  )

  return {
    sortRules,
    filterRules,
    columnWidths,
    viewMode,
    activeView,
    isDirty,
    isViewReadOnly,
    myViews,
    sharedViews,
    viewsLoading,
    setSort,
    setFilterRules,
    setColumnWidth,
    setViewMode,
    loadView,
    saveCurrentView,
    createView,
    deleteView,
  }
}

// ─── Pure utilities ───────────────────────────────────────────────────────────

export function applyFilterRules<T extends object>(
  rows: T[],
  rules: FilterRule[],
  columns: ColumnDef<T>[],
): T[] {
  if (!rules.length) return rows
  const colMap = new Map(columns.map((c) => [c.key, c]))
  return rows.filter((row) =>
    rules.every((rule) => {
      const col = colMap.get(rule.column)
      const rawVal = col?.getValue
        ? col.getValue(row)
        : (row as Record<string, unknown>)[rule.column]
      const strVal = rawVal == null ? '' : String(rawVal).toLowerCase()
      const ruleVal = rule.value.toLowerCase()
      switch (rule.operator as FilterOperator) {
        case 'equals':       return strVal === ruleVal
        case 'not_equals':   return strVal !== ruleVal
        case 'contains':     return strVal.includes(ruleVal)
        case 'not_contains': return !strVal.includes(ruleVal)
        case 'starts_with':  return strVal.startsWith(ruleVal)
        case 'is_empty':     return strVal === ''
        case 'is_not_empty': return strVal !== ''
        default:             return true
      }
    }),
  )
}

export function applySortRules<T extends object>(
  rows: T[],
  rules: SortRule[],
  columns: ColumnDef<T>[],
): T[] {
  if (!rules.length) return rows
  const colMap = new Map(columns.map((c) => [c.key, c]))
  return [...rows].sort((a, b) => {
    for (const rule of rules) {
      const col = colMap.get(rule.column)
      const aVal = col?.getValue
        ? col.getValue(a)
        : (a as Record<string, unknown>)[rule.column]
      const bVal = col?.getValue
        ? col.getValue(b)
        : (b as Record<string, unknown>)[rule.column]
      const aStr = aVal == null ? '' : String(aVal).toLowerCase()
      const bStr = bVal == null ? '' : String(bVal).toLowerCase()
      const cmp = aStr < bStr ? -1 : aStr > bStr ? 1 : 0
      if (cmp !== 0) return rule.direction === 'asc' ? cmp : -cmp
    }
    return 0
  })
}

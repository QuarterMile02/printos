'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import type { FilterRule, SortRule } from './types'

export interface UseDataTableQueryOptions<T> {
  tableKey: string
  orgId: string
  select: string
  filterRules: FilterRule[]
  sortRules: SortRule[]
  search: string
  searchColumns?: string[]
  page: number
  pageSize: number
  initialRows?: T[]
  initialTotalCount?: number
  // When provided and search.length >= 2, called instead of the default
  // ILIKE path in fetchDataTablePage. Used by pages with custom RPC search
  // (e.g. Customers' search_customers_fuzzy).
  searchFn?: (term: string) => Promise<T[]>
}

export interface UseDataTableQueryResult<T> {
  rows: T[]
  totalCount: number
  loading: boolean
  error: string | undefined
}

const SEARCH_DEBOUNCE_MS = 300

export function useDataTableQuery<T>({
  tableKey,
  orgId,
  select,
  filterRules,
  sortRules,
  search,
  searchColumns,
  page,
  pageSize,
  initialRows = [],
  initialTotalCount = 0,
  searchFn,
}: UseDataTableQueryOptions<T>): UseDataTableQueryResult<T> {
  const [rows, setRows] = useState<T[]>(initialRows)
  const [totalCount, setTotalCount] = useState(initialTotalCount)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  // Sequence counter — discards responses that arrive out of order.
  const seqRef = useRef(0)
  // Debounce timer ref for search-as-you-type.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track whether the current query params match the initial SSR render so we
  // can skip the redundant first client-side fetch.
  const isFirstRender = useRef(true)

  const runBrowseQuery = useCallback(async (seq: number) => {
    setLoading(true)
    const result = await fetchDataTablePage<T>({
      tableKey,
      orgId,
      select,
      filterRules,
      sortRules,
      page,
      pageSize,
    })
    if (seqRef.current !== seq) return
    setLoading(false)
    if (result.error) {
      setError(result.error)
    } else {
      setRows(result.rows)
      setTotalCount(result.totalCount)
      setError(undefined)
    }
  }, [tableKey, orgId, select, filterRules, sortRules, page, pageSize])

  const runSearchQuery = useCallback(async (term: string, seq: number) => {
    if (!searchFn) return
    setLoading(true)
    try {
      const results = await searchFn(term)
      if (seqRef.current !== seq) return
      setRows(results)
      setTotalCount(results.length)
      setError(undefined)
    } catch (e) {
      if (seqRef.current !== seq) return
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      if (seqRef.current === seq) setLoading(false)
    }
  }, [searchFn])

  useEffect(() => {
    // Skip the initial fetch when the component hydrates with SSR data and
    // none of the query params have changed — avoids a redundant double-fetch.
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const isSearchMode = search.length >= 2
    const seq = ++seqRef.current

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (isSearchMode && searchFn) {
      // Debounce search-as-you-type; fire filter/sort/page changes immediately.
      debounceRef.current = setTimeout(() => {
        runSearchQuery(search, seq)
      }, SEARCH_DEBOUNCE_MS)
    } else if (isSearchMode && searchColumns && searchColumns.length > 0) {
      // ILIKE search via fetchDataTablePage — also debounced.
      debounceRef.current = setTimeout(() => {
        fetchDataTablePage<T>({
          tableKey, orgId, select, filterRules, sortRules,
          search, searchColumns,
          page, pageSize,
        }).then((result) => {
          if (seqRef.current !== seq) return
          setLoading(false)
          if (result.error) {
            setError(result.error)
          } else {
            setRows(result.rows)
            setTotalCount(result.totalCount)
            setError(undefined)
          }
        })
        setLoading(true)
      }, SEARCH_DEBOUNCE_MS)
    } else {
      // Browse mode (no active search) — fire immediately.
      runBrowseQuery(seq)
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [
    tableKey, orgId, select,
    filterRules, sortRules,
    search, searchColumns,
    page, pageSize,
    runBrowseQuery, runSearchQuery, searchFn,
  ])

  return { rows, totalCount, loading, error }
}

'use server'

import { createClient } from '@/lib/supabase/server'
import type { FilterRule, SortRule } from '@/components/data-table/types'

// Tables permitted to be queried through this function.
// Never expose this to the client — the key is validated server-side only.
const TABLE_ALLOWLIST: Record<string, string> = {
  customers: 'customers',
  products: 'products',
  quotes: 'quotes',
  sales_orders: 'sales_orders',
  invoices: 'invoices',
  purchase_orders: 'purchase_orders',
  vendors: 'vendors',
  tasks: 'tasks',
  materials: 'materials',
  discounts: 'discounts',
  material_categories: 'material_categories',
  product_categories: 'product_categories',
  shipments: 'shipments',
}

export type DataTableFetchParams = {
  tableKey: string
  orgId: string
  select: string
  filterRules: FilterRule[]
  sortRules: SortRule[]
  search?: string
  searchColumns?: string[]
  page: number
  pageSize: number
}

export type DataTableFetchResult<T> = {
  rows: T[]
  totalCount: number
  error?: string
}

// Translate a single FilterRule into a Supabase query chain.
// Returns the mutated query builder.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilter(query: any, rule: FilterRule): any {
  const { column, operator, value } = rule
  switch (operator) {
    case 'equals':
      return query.eq(column, value)
    case 'not_equals':
      return query.neq(column, value)
    case 'contains':
      return query.ilike(column, `%${value}%`)
    case 'not_contains':
      return query.not(column, 'ilike', `%${value}%`)
    case 'starts_with':
      return query.ilike(column, `${value}%`)
    case 'is_empty':
      return query.or(`${column}.is.null,${column}.eq.`)
    case 'is_not_empty':
      return query.not(column, 'is', null).neq(column, '')
    default:
      return query
  }
}

export async function fetchDataTablePage<T>(
  params: DataTableFetchParams,
): Promise<DataTableFetchResult<T>> {
  const { tableKey, orgId, select, filterRules, sortRules, search, searchColumns, page, pageSize } = params

  const table = TABLE_ALLOWLIST[tableKey]
  if (!table) {
    return { rows: [], totalCount: 0, error: `Unknown table key: ${tableKey}` }
  }

  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from(table)
    .select(select, { count: 'exact' })
    .eq('organization_id', orgId)

  // Apply saved-view filter rules
  for (const rule of filterRules) {
    query = applyFilter(query, rule)
  }

  // Apply ILIKE search across specified columns (ORed together).
  // PostgREST's .or() filter string uses commas as condition separators and
  // parens for .in.() grouping — these must be stripped from the search term,
  // not escaped (no escape mechanism exists in this context). Quotes are also
  // stripped. Dots and wildcards (% _) are left as-is: dots are safe inside
  // the value segment (PostgREST splits only on the first two dots per condition),
  // and wildcards are an intentional power-user feature.
  if (search && search.length >= 2 && searchColumns && searchColumns.length > 0) {
    const safeTerm = search.replace(/[,()'"]/g, ' ').trim()
    if (safeTerm.length >= 2) {
      const conditions = searchColumns
        .map((col) => `${col}.ilike.%${safeTerm}%`)
        .join(',')
      query = query.or(conditions)
    }
  }

  // Apply sort rules
  for (const rule of sortRules) {
    query = query.order(rule.column, {
      ascending: rule.direction === 'asc',
      nullsFirst: rule.direction === 'desc',
    })
  }

  // Page range (0-indexed on Supabase)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  query = query.range(from, to)

  const { data, count, error } = await query

  if (error) {
    return { rows: [], totalCount: 0, error: error.message }
  }

  return {
    rows: (data ?? []) as T[],
    totalCount: count ?? 0,
  }
}

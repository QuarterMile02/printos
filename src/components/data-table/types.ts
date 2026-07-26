export type SortDirection = 'asc' | 'desc'

export type SortRule = {
  column: string
  direction: SortDirection
}

export type FilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'starts_with'
  | 'is_empty'
  | 'is_not_empty'

export type FilterRule = {
  id: string
  column: string
  operator: FilterOperator
  value: string
}

export type ViewType = 'personal' | 'collaborative' | 'locked'

export type SavedView = {
  id: string
  organization_id: string
  table_key: string
  name: string
  created_by: string
  view_type: ViewType
  shared_with_roles: string[]
  shared_with_user_ids: string[]
  column_widths: Record<string, number>
  column_order: string[]
  sort_rules: SortRule[]
  filter_rules: FilterRule[]
  is_default: boolean
  created_at: string
  updated_at: string
}

// Non-generic column metadata — used by toolbar/filter UI components
export type ColumnMeta = {
  key: string
  label: string
  defaultWidth: number
  sortable?: boolean
  filterable?: boolean
  filterType?: 'text' | 'select' | 'number' | 'date'
  filterOptions?: { label: string; value: string }[]
  resizable?: boolean  // default true; set false to disable drag handle
}

// Generic column definition — extends ColumnMeta with a typed getValue accessor
// used by applyFilterRules / applySortRules utilities
export type ColumnDef<T> = ColumnMeta & {
  getValue?: (row: T) => string | number | null | undefined
}

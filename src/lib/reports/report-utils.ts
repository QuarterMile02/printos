// Shared utilities for the /reports section. Date-range parsing,
// CSV building, and the canonical report-type registry.

export type ReportType =
  | 'quotes'
  | 'sales-orders'
  | 'invoices'
  | 'jobs'
  | 'customers'
  | 'payments'
  | 'purchase-orders'
  | 'transactions'
  | 'products'
  | 'shipments'

export type FinancialReportType =
  | 'collections'
  | 'sales-by-rep'
  | 'productivity'
  | 'sales-tax'
  | 'revenue-by-unit'

export const REPORT_DEFS: { type: ReportType; title: string; description: string }[] = [
  { type: 'quotes',          title: 'Quotes',          description: 'All quotes by status, sales rep, and date range.' },
  { type: 'sales-orders',    title: 'Sales Orders',    description: 'Open and completed sales orders with deposit and total.' },
  { type: 'invoices',        title: 'Invoices',        description: 'Invoiced revenue with aging buckets (0-30/31-60/61-90/90+).' },
  { type: 'jobs',            title: 'Jobs',            description: 'Production jobs by stage, workflow, department, and assignee.' },
  { type: 'customers',       title: 'Customers',       description: 'Customer order count and lifetime revenue.' },
  { type: 'payments',        title: 'Payments',        description: 'Payments received by method and date range.' },
  { type: 'purchase-orders', title: 'Purchase Orders', description: 'POs to vendors by status and amount.' },
  { type: 'transactions',    title: 'Transactions',    description: 'Combined invoice + payment ledger.' },
  { type: 'products',        title: 'Products',        description: 'Times quoted and ordered per product.' },
  { type: 'shipments',       title: 'Shipments',       description: 'Outbound shipments and tracking status.' },
]

export type DateRangePreset = 'today' | 'this_week' | 'this_month' | 'last_30' | 'last_90' | 'ytd' | 'custom'

export const DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today',      label: 'Today' },
  { value: 'this_week',  label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_30',    label: 'Last 30 Days' },
  { value: 'last_90',    label: 'Last 90 Days' },
  { value: 'ytd',        label: 'YTD' },
  { value: 'custom',     label: 'Custom' },
]

// Resolve a preset to a [start, end] window in ISO date strings.
// `now` is injectable for tests; default = current time.
export function resolveDateRange(
  preset: DateRangePreset | undefined,
  customStart: string | undefined,
  customEnd: string | undefined,
  now: Date = new Date(),
): { start: string; end: string } {
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const endOfDay   = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
  const today = startOfDay(now)
  const todayEnd = endOfDay(now)

  switch (preset) {
    case 'today':
      return { start: today.toISOString(), end: todayEnd.toISOString() }
    case 'this_week': {
      const day = today.getDay() // 0=Sun … 6=Sat. Treat Mon as week start.
      const offset = day === 0 ? 6 : day - 1
      const monday = new Date(today); monday.setDate(today.getDate() - offset)
      return { start: monday.toISOString(), end: todayEnd.toISOString() }
    }
    case 'this_month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      return { start: first.toISOString(), end: todayEnd.toISOString() }
    }
    case 'last_30': {
      const start = new Date(today); start.setDate(today.getDate() - 29)
      return { start: start.toISOString(), end: todayEnd.toISOString() }
    }
    case 'last_90': {
      const start = new Date(today); start.setDate(today.getDate() - 89)
      return { start: start.toISOString(), end: todayEnd.toISOString() }
    }
    case 'ytd': {
      const first = new Date(today.getFullYear(), 0, 1)
      return { start: first.toISOString(), end: todayEnd.toISOString() }
    }
    case 'custom': {
      const start = customStart ? startOfDay(new Date(customStart + 'T00:00:00')) : new Date('1970-01-01')
      const end   = customEnd   ? endOfDay(new Date(customEnd   + 'T00:00:00')) : todayEnd
      return { start: start.toISOString(), end: end.toISOString() }
    }
    default: {
      // No preset = last 30 days. Reasonable default for revenue reports.
      const start = new Date(today); start.setDate(today.getDate() - 29)
      return { start: start.toISOString(), end: todayEnd.toISOString() }
    }
  }
}

// CSV cell escape — quotes the value if it contains comma/quote/newline,
// doubles internal quotes per RFC 4180.
function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'number' ? String(v) : v
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(',')]
  for (const r of rows) lines.push(r.map(csvCell).join(','))
  return lines.join('\r\n') + '\r\n'
}

export const FINANCIAL_REPORT_DEFS: { type: FinancialReportType; title: string; description: string }[] = [
  { type: 'collections',      title: 'Collections',       description: 'Outstanding invoices with collection call history and days overdue.' },
  { type: 'sales-by-rep',     title: 'Sales by Rep',      description: 'Quote totals and win rates grouped by sales representative.' },
  { type: 'productivity',     title: 'Productivity',      description: 'Jobs completed, in progress, and overdue per team member.' },
  { type: 'sales-tax',        title: 'Sales Tax',         description: 'Tax collected per invoice with subtotal and total breakdown.' },
  { type: 'revenue-by-unit',  title: 'Revenue by Unit',   description: 'Invoice revenue attributed to each production department.' },
]

export const PAGE_SIZE = 50

// Pagination math used by every report page. Clamps to valid ranges.
export function paginate(total: number, page: number | undefined): {
  page: number; from: number; to: number; pageCount: number
} {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safe = Math.min(Math.max(1, page ?? 1), pageCount)
  const from = (safe - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  return { page: safe, from, to, pageCount }
}

// Plain, directive-free module shared between jobs/page.tsx (server) and
// jobs-list-client.tsx (client). These were originally exported from
// jobs-list-client.tsx itself ('use client') and imported directly into
// page.tsx (a server component) -- the exact same class of bug fixed
// earlier for the Display Board crash, just the mirror direction:
// plain constants exported from a directive-marked module don't cross
// that boundary as real values the way component exports do. Here it
// surfaced as fetchDataTablePage's internal `select.split(',')` throwing
// "split is not a function" the instant the Jobs page loaded, since
// JOBS_DB_SELECT wasn't actually the string on the server side of that
// import. Moving genuinely-shared data to its own undirected module (no
// 'use client'/'use server') is the fix, same as board-config.ts.

export type JobListRow = {
  id: string
  job_number: number
  title: string
  due_date: string | null
  department: string | null
  flag: string | null
  customer_id: string | null
  sales_order_id: string | null
  invoice_id: string | null
}

export const JOBS_DB_SELECT = 'id, job_number, title, due_date, department, flag, customer_id, sales_order_id, invoice_id'
export const JOBS_PAGE_SIZE = 50

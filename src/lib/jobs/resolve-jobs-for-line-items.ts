import type { SupabaseClient } from '@supabase/supabase-js'

export type ResolvedJob = {
  id: string
  job_number: number
  title: string
  status: string
  due_date: string | null
  quote_line_item_id: string | null
}

// Keyed by quote_line_items.id -> the job that covers it.
export type LineItemJobMap = Record<string, ResolvedJob>

// Resolves "the job that covers this line item under this SO," accounting
// for jobs created before migration 121's job-per-line-item grain change.
//
// Post-121, this is unambiguous: jobs.quote_line_item_id is a direct 1:1
// FK, so each line item maps to at most one job.
//
// Pre-121 jobs have quote_line_item_id = NULL and instead cover *every*
// line item on their sales order at once (the old grain, one job per SO).
// Production data still has real jobs in this shape (SO-0001 through
// SO-0005 at the time this was written) -- without this fallback, every
// line item on those orders would incorrectly show "no job," even though
// a real job exists and has real status/proofs/etc. So: for any line item
// with no exact quote_line_item_id match, fall back to the SO's one
// legacy (quote_line_item_id IS NULL) job, if it has one.
//
// Shared by the Sales Order detail page (bulk resolution for every line
// item on the page) and uploadProofForLineItem (single-item resolution on
// the write path) so the matching rule can't drift between the two.
export async function resolveJobsForLineItems(
  service: SupabaseClient,
  orgId: string,
  soId: string,
  lineItemIds: string[],
): Promise<LineItemJobMap> {
  const map: LineItemJobMap = {}
  if (lineItemIds.length === 0) return map

  const { data: jobs } = await service
    .from('jobs')
    .select('id, job_number, title, status, due_date, quote_line_item_id')
    .eq('organization_id', orgId)
    .eq('sales_order_id', soId) as { data: ResolvedJob[] | null }

  const legacyJob = (jobs ?? []).find((j) => !j.quote_line_item_id) ?? null

  for (const id of lineItemIds) {
    const exact = (jobs ?? []).find((j) => j.quote_line_item_id === id)
    const resolved = exact ?? legacyJob
    if (resolved) map[id] = resolved
  }

  return map
}

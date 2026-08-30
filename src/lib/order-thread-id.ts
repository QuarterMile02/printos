// Shared order_thread_id resolution — the same anchor definition used by
// migration 132/133 and the originally-private resolveOrderThreadId in
// invoices/[id]/actions.ts: the originating quote_id, or the sales_order's
// own id when there's no quote. Extracted here because multiple
// logActivity() call sites across quotes/sales-orders/jobs/invoices need
// this exact resolution — inlining it per call site risks the copies
// drifting apart.

import type { createServiceClient } from '@/lib/supabase/server'

// Takes a service client specifically, not a union with the RLS-scoped
// client — createClient()'s and createServiceClient()'s return types don't
// unify cleanly through a single callable .from() (TS can't merge their
// overloaded signatures), and every existing call site already has a
// service client available or can cheaply get one.
type ServiceClient = ReturnType<typeof createServiceClient>

// Resolves the anchor for a sales-order-rooted action.
export async function resolveOrderThreadIdFromSalesOrder(
  service: ServiceClient, salesOrderId: string | null,
): Promise<string | null> {
  if (!salesOrderId) return null
  const { data } = await service
    .from('sales_orders').select('quote_id').eq('id', salesOrderId).maybeSingle() as
    { data: { quote_id: string | null } | null; error: unknown }
  return data?.quote_id ?? salesOrderId
}

// Resolves the anchor for a job-rooted action: prefer the job's own
// source_quote_id (matches the existing read-site convention — see
// convert-action.ts's comment on why both source_quote_id and
// sales_order_id are set on every job), falling back through its
// sales_order_id when there's no source quote.
export async function resolveOrderThreadIdFromJob(
  service: ServiceClient, job: { source_quote_id: string | null; sales_order_id: string | null },
): Promise<string | null> {
  if (job.source_quote_id) return job.source_quote_id
  return resolveOrderThreadIdFromSalesOrder(service, job.sales_order_id)
}

// Invoice-rooted actions resolve through the same sales_order_id ->
// quote_id chain — no separate function needed, call
// resolveOrderThreadIdFromSalesOrder(client, invoice.sales_order_id)
// directly.

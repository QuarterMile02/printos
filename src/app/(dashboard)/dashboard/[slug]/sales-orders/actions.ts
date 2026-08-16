'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole, SalesOrderStatus } from '@/types/database'
import { logActivity } from '@/lib/logActivity'

const ALLOWED_STATUSES: SalesOrderStatus[] = [
  'completed', 'hold', 'no_charge', 'no_charge_approved', 'void',
]

export type SoSearchRow = {
  id: string
  so_number: number
  title: string | null
  status: SalesOrderStatus
  total: number | null
  created_at: string
  customer_id: string | null
  customers: { first_name: string; last_name: string; company_name: string | null } | null
  shipments: { id: string }[] | null
}

type SoFuzzyRpcRow = {
  id: string
  so_number: number
  title: string | null
  status: SalesOrderStatus
  total: number | null
  created_at: string
  customer_id: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  customer_company_name: string | null
}

// Trigram fuzzy search (migration 127's search_sales_orders_fuzzy) —
// replaces the previous two-round-trip TypeScript approach (a preliminary
// ILIKE-only customer lookup feeding a customer_id.in.(...) condition into
// the main sales_orders query), which existed only because PostgREST's
// or() logic-tree parser can't express a nested-column ILIKE or a numeric
// cast in one call. A real SQL function can freely JOIN and reference
// joined columns, so this collapses to one round trip AND upgrades
// customer-name matching from exact-ILIKE-only to the same 3-strategy
// fuzziness as title. Numeric exact-match semantics unchanged: dollar
// amount -> cents -> `total =` equality, bare integer -> `so_number =`
// equality — computed inside the RPC now, same values, same rounding.
//
// The RPC doesn't join shipments (kept it scoped to what 062's own
// pattern covers — text/numeric/customer matching), so shipment counts
// for the matched rows are fetched in a small follow-up query here,
// same "resolve per-current-result-set" shape as Jobs' customer-name join.
export async function searchSalesOrders(orgId: string, term: string): Promise<SoSearchRow[]> {
  const cleaned = term.trim()
  if (cleaned.length < 2) return []

  const service = createServiceClient()
  const { data, error } = await service.rpc('search_sales_orders_fuzzy', {
    p_org_id: orgId,
    p_term: cleaned,
  }) as { data: SoFuzzyRpcRow[] | null; error: { message: string } | null }

  if (error) {
    console.error('[searchSalesOrders]', error.message)
    return []
  }

  const rows = data ?? []
  if (rows.length === 0) return []

  const soIds = rows.map((r) => r.id)
  const { data: shipmentRows } = await service
    .from('shipments')
    .select('id, sales_order_id')
    .in('sales_order_id', soIds) as { data: { id: string; sales_order_id: string }[] | null }

  const shipmentsBySoId = new Map<string, { id: string }[]>()
  for (const s of shipmentRows ?? []) {
    const list = shipmentsBySoId.get(s.sales_order_id) ?? []
    list.push({ id: s.id })
    shipmentsBySoId.set(s.sales_order_id, list)
  }

  // Reshape the RPC's flat customer_* columns back into the nested
  // `customers` object SoSearchRow (and every consumer of it) expects —
  // keeps so-list-client.tsx untouched.
  return rows.map((r) => ({
    id: r.id,
    so_number: r.so_number,
    title: r.title,
    status: r.status,
    total: r.total,
    created_at: r.created_at,
    customer_id: r.customer_id,
    customers: r.customer_id
      ? {
          first_name: r.customer_first_name ?? '',
          last_name: r.customer_last_name ?? '',
          company_name: r.customer_company_name,
        }
      : null,
    shipments: shipmentsBySoId.get(r.id) ?? null,
  }))
}

export async function updateSalesOrderStatus(
  soId: string,
  orgId: string,
  orgSlug: string,
  status: SalesOrderStatus,
): Promise<{ error?: string }> {
  if (!ALLOWED_STATUSES.includes(status)) {
    return { error: 'This status cannot be set manually.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update sales orders.' }

  const service = createServiceClient()

  // Read previous status for activity log — quote_id added to this same
  // select (was just status) to resolve order_thread_id without an extra
  // round trip: a quote_id ?? soId, same anchor rule as everywhere else.
  const { data: prevSo } = await service
    .from('sales_orders')
    .select('status, quote_id')
    .eq('id', soId)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { status: SalesOrderStatus; quote_id: string | null } | null; error: unknown }

  const { error } = await service
    .from('sales_orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', soId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  await logActivity({
    org_id: orgId,
    user_id: user.id,
    entity_type: 'sales_order',
    entity_id: soId,
    action: 'status_changed',
    from_value: prevSo?.status,
    to_value: status,
    order_thread_id: prevSo?.quote_id ?? soId,
  })

  // Auto-create invoice when SO is completed
  if (status === 'completed') {
    try {
      // Check no invoice exists yet for this SO
      const { data: existing } = await service
        .from('invoices')
        .select('id')
        .eq('sales_order_id', soId)
        .maybeSingle()

      if (!existing) {
        // Get SO details
        const { data: soRow } = await service
          .from('sales_orders')
          .select('id, title, customer_id, total, quote_id')
          .eq('id', soId)
          .single()
        const so = soRow as { id: string; title: string | null; customer_id: string | null; total: number | null; quote_id: string | null } | null

        if (so) {
          // Get quote totals if available
          let subtotal = so.total ?? 0
          let taxTotal = 0
          if (so.quote_id) {
            const { data: q } = await service
              .from('quotes')
              .select('subtotal, tax_total, total')
              .eq('id', so.quote_id)
              .single()
            const quote = q as { subtotal: number | null; tax_total: number | null; total: number | null } | null
            if (quote) {
              subtotal = quote.subtotal ?? subtotal
              taxTotal = quote.tax_total ?? 0
            }
          }

          const total = subtotal + taxTotal
          const dueDate = new Date()
          dueDate.setDate(dueDate.getDate() + 30) // Net 30

          const { data: newInvoice, error: invoiceErr } = await service.from('invoices').insert({
            organization_id: orgId,
            sales_order_id: soId,
            title: so.title,
            customer_id: so.customer_id,
            subtotal,
            tax_total: taxTotal,
            total,
            balance_due: total,
            due_date: dueDate.toISOString().slice(0, 10),
            status: 'draft',
          }).select('id').single() as { data: { id: string } | null; error: { message: string } | null }

          if (invoiceErr) {
            // Best-effort by design (see catch below) — but a discarded
            // error here means the SO looks "invoiced" with no invoice ever
            // created, so it must not pass silently.
            console.error('[updateSalesOrderStatus] Auto-invoice insert failed:', invoiceErr.message, { soId })
          }

          if (newInvoice?.id) {
            await logActivity({
              org_id: orgId,
              user_id: user.id,
              entity_type: 'invoice',
              entity_id: newInvoice.id,
              action: 'created',
              metadata: { sales_order_id: soId, total },
              order_thread_id: so.quote_id ?? soId,
            })
          }

          revalidatePath(`/dashboard/${orgSlug}/invoices`)
        }
      }
    } catch (err) {
      console.error('[updateSalesOrderStatus] Invoice auto-create failed:', err)
      // Don't fail the SO status update if invoice creation fails
    }
  }

  revalidatePath(`/dashboard/${orgSlug}/sales-orders`)
  revalidatePath(`/dashboard/${orgSlug}/sales-orders/${soId}`)
  return {}
}

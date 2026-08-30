'use server'

import { createServiceClient } from '@/lib/supabase/server'

export type PurchaseOrderSearchRow = {
  id: string
  po_number: number
  title: string | null
  status: string
  total: number
  expected_delivery_date: string | null
  received_date: string | null
  created_at: string
  vendor_id: string | null
  vendors: { name: string } | null
  sales_order_id: string | null
  sales_orders: { so_number: number; title: string | null } | null
}

type PoFuzzyRpcRow = {
  id: string
  po_number: number
  title: string | null
  status: string
  total: number
  expected_delivery_date: string | null
  received_date: string | null
  created_at: string
  vendor_id: string | null
  vendor_name: string | null
  sales_order_id: string | null
  so_number: number | null
  so_title: string | null
}

// Trigram fuzzy search (migration 127's search_purchase_orders_fuzzy) —
// replaces the previous two-round-trip TypeScript approach (a preliminary
// ILIKE-only vendor lookup feeding a vendor_id.in.(...) condition into the
// main purchase_orders query), which existed only because PostgREST's
// or() logic-tree parser can't express a nested-column ILIKE or a numeric
// cast in one call. A real SQL function can freely JOIN and reference
// joined columns, so this collapses to one round trip AND upgrades
// vendor-name matching from exact-ILIKE-only to the same 3-strategy
// fuzziness as title.
//
// purchase_orders.total is NUMERIC(12,2) — real dollars-and-cents (e.g.
// 207.84), NOT integer cents like quotes/invoices/sales_orders (which
// store 20784 for the same amount). Both this wrapper's dead-code-free
// history and the RPC itself (search_purchase_orders_fuzzy's `ROUND(t.
// commaless::numeric, 2)`, deliberately NOT `* 100`) preserve that —
// confirmed no ×100 conversion crept in here the way it would if this had
// been copy-pasted from Quotes/SO/Invoices by habit.
export async function searchPurchaseOrders(orgId: string, term: string): Promise<PurchaseOrderSearchRow[]> {
  const cleaned = term.trim()
  if (cleaned.length < 2) return []

  const service = createServiceClient()
  const { data, error } = await service.rpc('search_purchase_orders_fuzzy', {
    p_org_id: orgId,
    p_term: cleaned,
  }) as { data: PoFuzzyRpcRow[] | null; error: { message: string } | null }

  if (error) {
    console.error('[searchPurchaseOrders]', error.message)
    return []
  }

  // Reshape the RPC's flat vendor_name/so_number/so_title columns back
  // into the nested `vendors`/`sales_orders` objects PurchaseOrderSearchRow
  // (and every consumer of it) expects — keeps po-list-client.tsx untouched.
  return (data ?? []).map((r) => ({
    id: r.id,
    po_number: r.po_number,
    title: r.title,
    status: r.status,
    total: r.total,
    expected_delivery_date: r.expected_delivery_date,
    received_date: r.received_date,
    created_at: r.created_at,
    vendor_id: r.vendor_id,
    vendors: r.vendor_id ? { name: r.vendor_name ?? '' } : null,
    sales_order_id: r.sales_order_id,
    sales_orders: r.sales_order_id ? { so_number: r.so_number ?? 0, title: r.so_title } : null,
  }))
}

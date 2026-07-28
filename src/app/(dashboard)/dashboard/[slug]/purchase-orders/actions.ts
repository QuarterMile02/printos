'use server'

import { createClient } from '@/lib/supabase/server'

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

// Search across title, vendor name, PO number, and total (typed as a
// dollar amount). Same proven approach as invoices/actions.ts's
// searchInvoices — PostgREST's or() logic-tree parser does NOT accept
// embedded-resource dot paths ("vendors.name.ilike...") or column casts
// ("po_number::text.ilike...") as condition fragments; both were confirmed
// to fail with "failed to parse logic tree" while building the Invoices
// version of this search. So vendor-name matching runs as a separate
// preliminary lookup against the vendors table (flat ILIKE, no dot path)
// whose matching ids feed a plain vendor_id.in.(...) condition, and
// po-number matching uses an exact integer equality instead of a cast
// substring search. Title stays a plain flat ILIKE since it's a real
// column on purchase_orders itself.
//
// purchase_orders.total is NUMERIC(12,2) — real dollars-and-cents (e.g.
// 207.84), NOT integer cents like quotes/invoices/sales_orders (which
// store 20784 for the same amount). The typed term is rounded to 2
// decimals directly; it must NOT be multiplied by 100 the way the other
// tables' search does, or every comparison would be 100x too large and
// never match.
export async function searchPurchaseOrders(orgId: string, term: string): Promise<PurchaseOrderSearchRow[]> {
  const cleaned = term.trim()
  if (cleaned.length < 2) return []

  const supabase = await createClient()

  // Strip commas (thousands separators) before checking whether the term is
  // a bare dollar amount, e.g. "1,234.56" -> "1234.56".
  const commaless = cleaned.replace(/,/g, '')
  const isDollarAmount = /^\d+(\.\d+)?$/.test(commaless)
  const totalMatch = isDollarAmount ? Math.round(parseFloat(commaless) * 100) / 100 : null
  const isPlainInteger = /^\d+$/.test(commaless)
  const poNumberMatch = isPlainInteger ? parseInt(commaless, 10) : null

  // Strip characters that would break PostgREST's or() filter syntax.
  const safeTerm = cleaned.replace(/[,()'"]/g, ' ').trim()

  const conditions: string[] = []
  if (safeTerm.length >= 2) {
    conditions.push(`title.ilike.%${safeTerm}%`)
  }
  if (totalMatch !== null) {
    conditions.push(`total.eq.${totalMatch}`)
  }
  if (poNumberMatch !== null) {
    conditions.push(`po_number.eq.${poNumberMatch}`)
  }
  if (safeTerm.length >= 2) {
    const { data: vendorRows } = await supabase
      .from('vendors')
      .select('id')
      .eq('organization_id', orgId)
      .ilike('name', `%${safeTerm}%`)
      .limit(50)
    const vendorIds = (vendorRows ?? []).map((r) => (r as { id: string }).id)
    if (vendorIds.length > 0) {
      conditions.push(`vendor_id.in.(${vendorIds.join(',')})`)
    }
  }
  if (conditions.length === 0) return []

  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id, po_number, title, status, total, expected_delivery_date, received_date, created_at, vendor_id, vendors(name), sales_order_id, sales_orders(so_number, title)')
    .eq('organization_id', orgId)
    .or(conditions.join(','))
    .order('po_number', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[searchPurchaseOrders]', error.message)
    return []
  }

  return (data ?? []) as PurchaseOrderSearchRow[]
}

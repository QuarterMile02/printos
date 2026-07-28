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

// Search across title, customer name, SO number, and total (typed as a
// dollar amount). Same proven approach as invoices/actions.ts's
// searchInvoices — PostgREST's or() logic-tree parser does NOT accept
// embedded-resource dot paths ("customers.first_name.ilike...") or column
// casts ("so_number::text.ilike...") as condition fragments; both were
// confirmed to fail with "failed to parse logic tree" against the live DB
// while building the Invoices version of this search. So customer-name
// matching runs as a separate preliminary lookup against the customers
// table (flat ILIKE, no dot path) whose matching ids feed a plain
// customer_id.in.(...) condition, and SO-number matching uses an exact
// integer equality instead of a cast substring search. Title stays a plain
// flat ILIKE since it's a real column on sales_orders itself.
export async function searchSalesOrders(orgId: string, term: string): Promise<SoSearchRow[]> {
  const cleaned = term.trim()
  if (cleaned.length < 2) return []

  const supabase = await createClient()

  // Strip commas (thousands separators) before checking whether the term is
  // a bare dollar amount, e.g. "1,234.56" -> "1234.56".
  const commaless = cleaned.replace(/,/g, '')
  const isDollarAmount = /^\d+(\.\d+)?$/.test(commaless)
  const totalCentsMatch = isDollarAmount ? Math.round(parseFloat(commaless) * 100) : null
  const isPlainInteger = /^\d+$/.test(commaless)
  const soNumberMatch = isPlainInteger ? parseInt(commaless, 10) : null

  // Strip characters that would break PostgREST's or() filter syntax.
  const safeTerm = cleaned.replace(/[,()'"]/g, ' ').trim()

  const conditions: string[] = []
  if (safeTerm.length >= 2) {
    conditions.push(`title.ilike.%${safeTerm}%`)
  }
  if (totalCentsMatch !== null) {
    conditions.push(`total.eq.${totalCentsMatch}`)
  }
  if (soNumberMatch !== null) {
    conditions.push(`so_number.eq.${soNumberMatch}`)
  }
  if (safeTerm.length >= 2) {
    const { data: customerRows } = await supabase
      .from('customers')
      .select('id')
      .eq('organization_id', orgId)
      .or(`first_name.ilike.%${safeTerm}%,last_name.ilike.%${safeTerm}%,company_name.ilike.%${safeTerm}%`)
      .limit(50)
    const customerIds = (customerRows ?? []).map((r) => (r as { id: string }).id)
    if (customerIds.length > 0) {
      conditions.push(`customer_id.in.(${customerIds.join(',')})`)
    }
  }
  if (conditions.length === 0) return []

  const { data, error } = await supabase
    .from('sales_orders')
    .select('id, so_number, title, status, total, created_at, customer_id, customers(first_name, last_name, company_name), shipments(id)')
    .eq('organization_id', orgId)
    .or(conditions.join(','))
    .order('so_number', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[searchSalesOrders]', error.message)
    return []
  }

  return (data ?? []) as SoSearchRow[]
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

  // Read previous status for activity log
  const { data: prevSo } = await service
    .from('sales_orders')
    .select('status')
    .eq('id', soId)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { status: SalesOrderStatus } | null; error: unknown }

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
          .select('id, customer_id, total, quote_id')
          .eq('id', soId)
          .single()
        const so = soRow as { id: string; customer_id: string | null; total: number | null; quote_id: string | null } | null

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

          const { data: newInvoice } = await service.from('invoices').insert({
            organization_id: orgId,
            sales_order_id: soId,
            customer_id: so.customer_id,
            subtotal,
            tax_total: taxTotal,
            total,
            balance_due: total,
            due_date: dueDate.toISOString().slice(0, 10),
            status: 'draft',
          }).select('id').single() as { data: { id: string } | null; error: unknown }

          if (newInvoice?.id) {
            await logActivity({
              org_id: orgId,
              user_id: user.id,
              entity_type: 'invoice',
              entity_id: newInvoice.id,
              action: 'created',
              metadata: { sales_order_id: soId, total },
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

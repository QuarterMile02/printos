'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole, SalesOrderStatus } from '@/types/database'

const ALLOWED_STATUSES: SalesOrderStatus[] = [
  'completed', 'hold', 'no_charge', 'no_charge_approved', 'void',
]

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
  const { error } = await service
    .from('sales_orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', soId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

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

          await service.from('invoices').insert({
            organization_id: orgId,
            sales_order_id: soId,
            customer_id: so.customer_id,
            subtotal,
            tax_total: taxTotal,
            total,
            balance_due: total,
            due_date: dueDate.toISOString().slice(0, 10),
            status: 'draft',
          })

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

'use server'

import { createServiceClient } from '@/lib/supabase/server'

export async function postInvoices(invoiceIds: string[], orgId: string): Promise<{ posted?: number; error?: string }> {
  if (!invoiceIds.length) return { error: 'No invoices selected' }

  const service = createServiceClient()

  // Verify all invoices belong to this org before updating
  const { data: owned } = await service
    .from('invoices')
    .select('id')
    .eq('organization_id', orgId)
    .in('id', invoiceIds)

  const ownedIds = ((owned ?? []) as { id: string }[]).map(r => r.id)
  if (ownedIds.length === 0) return { error: 'No valid invoices found for this organization' }

  const { error } = await service
    .from('invoices')
    .update({ is_posted: true, posted_at: new Date().toISOString() })
    .in('id', ownedIds)

  if (error) return { error: error.message }
  return { posted: ownedIds.length }
}

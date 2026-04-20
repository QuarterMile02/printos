'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { logActivity } from '@/lib/logActivity'

export async function convertToSalesOrder(formData: FormData) {
  const quoteId = formData.get('quoteId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string

  const service = createServiceClient()

  // Fetch quote
  const { data: quote, error: qErr } = await service
    .from('quotes')
    .select('id, title, customer_id, total')
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .single()

  if (qErr || !quote) {
    console.error('[convertToSalesOrder] Quote fetch failed:', qErr?.message)
    throw new Error(qErr?.message ?? 'Quote not found')
  }

  // Insert sales order
  const { data: so, error: soErr } = await service
    .from('sales_orders')
    .insert({
      organization_id: orgId,
      quote_id: quoteId,
      customer_id: (quote as Record<string, unknown>).customer_id as string | null,
      title: (quote as Record<string, unknown>).title as string,
      total: ((quote as Record<string, unknown>).total as number) ?? 0,
      status: 'new',
    })
    .select('id, so_number, created_at')
    .single()

  if (soErr || !so) {
    console.error('[convertToSalesOrder] SO insert failed:', soErr?.message)
    throw new Error(soErr?.message ?? 'Failed to create sales order')
  }

  console.log('[convertToSalesOrder] Created SO:', (so as Record<string, unknown>).id)

  // Update quote status to ordered and link SO
  const soId = (so as Record<string, unknown>).id as string
  const soNumber = (so as Record<string, unknown>).so_number as number

  // Activity log: SO created + quote converted
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await logActivity({
        org_id: orgId,
        user_id: user.id,
        entity_type: 'sales_order',
        entity_id: soId,
        action: 'created',
        metadata: { so_number: soNumber, quote_id: quoteId },
      })
      await logActivity({
        org_id: orgId,
        user_id: user.id,
        entity_type: 'quote',
        entity_id: quoteId,
        action: 'converted_to_so',
        to_value: `SO-${String(soNumber).padStart(4, '0')}`,
        metadata: { sales_order_id: soId },
      })
    }
  } catch (err) {
    console.error('[convertToSalesOrder] logActivity failed:', err)
  }
  const { error: updateErr } = await service
    .from('quotes')
    .update({ status: 'ordered', converted_to_so_id: soId })
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  if (updateErr) {
    // Fallback: if converted_to_so_id column doesn't exist, just update status
    if (updateErr.message?.includes('does not exist')) {
      await service
        .from('quotes')
        .update({ status: 'ordered' })
        .eq('id', quoteId)
        .eq('organization_id', orgId)
    } else {
      console.error('[convertToSalesOrder] Quote update failed:', updateErr.message)
    }
  }

  redirect(`/dashboard/${orgSlug}/sales-orders/${soId}`)
}

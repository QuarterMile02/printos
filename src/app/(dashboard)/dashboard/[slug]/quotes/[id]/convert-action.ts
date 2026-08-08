'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { logActivity } from '@/lib/logActivity'
import { calculateProofDueDate } from '@/lib/date-utils'
import { resolveJobDepartments } from '@/lib/jobs/resolve-departments'

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
  const soLabel = `SO-${String(soNumber).padStart(4, '0')}`

  // One job PER LINE ITEM (migration 121) -- matches ShopVOX's own
  // behavior and this project's own documented target grain (see
  // Docs/PrintOS_Project_Status_v17.py / Blueprint_Internal_Spec_v25.py's
  // "ShopVOX Jobs-Family Research" tables: "1 job (= 1 line item off a
  // Sales Order)"). Previously this inserted exactly one job for the
  // whole SO; every read site that cares about a job's specific product
  // (workflow steps, the job board's per-card product lookup, the proof
  // upload line-item tag) already assumed or degraded toward per-line-item
  // data, so this brings the write side in line with what the read side
  // was already built for.
  type QuoteLineItemRow = {
    id: string
    description: string | null
    product_name: string | null
  }
  const { data: lineItems, error: liErr } = await service
    .from('quote_line_items')
    .select('id, description, product_name')
    .eq('quote_id', quoteId)
    .order('sort_order') as { data: QuoteLineItemRow[] | null; error: unknown }

  if (liErr) {
    console.error('[convertToSalesOrder] quote_line_items fetch failed:', liErr)
  }

  const createdJobs: { id: string; job_number: number }[] = []
  for (const li of lineItems ?? []) {
    // Resolve departments from THIS line item's own product (non-fatal —
    // a job with no resolvable department still gets created, same as
    // before; department assignment can happen manually).
    let upcomingDepartments: string[] = []
    let primaryDepartment: string | null = null
    try {
      upcomingDepartments = await resolveJobDepartments(quoteId, orgId, service, li.id)
      if (upcomingDepartments.length === 1) primaryDepartment = upcomingDepartments[0]
    } catch (err) {
      console.error('[convertToSalesOrder] resolveJobDepartments failed:', err)
    }

    const itemLabel = (li.product_name?.trim() || li.description?.trim() || 'Line Item')

    // Sets BOTH sales_order_id and source_quote_id -- found live via an
    // end-to-end proof-send test that this insert only ever set
    // sales_order_id, while every read site (jobs/[jobId]/page.tsx's
    // SO/quote breadcrumb lookup, the SO page's own Jobs section, and the
    // proof-send "ready proofs" query) looks jobs up by source_quote_id.
    // Setting both here satisfies that existing convention without
    // touching every read site.
    const { data: newJob, error: jobErr } = await service
      .from('jobs')
      .insert({
        organization_id: orgId,
        sales_order_id: soId,
        source_quote_id: quoteId,
        quote_line_item_id: li.id,
        customer_id: (quote as Record<string, unknown>).customer_id as string | null,
        title: `${itemLabel} — ${soLabel}`,
        status: 'new',
        proof_status: 'not_started',
        proof_due_date: calculateProofDueDate(new Date()).toISOString(),
        upcoming_departments: upcomingDepartments,
        department: primaryDepartment,
      })
      .select('id, job_number')
      .single()

    if (jobErr || !newJob) {
      console.error(`[convertToSalesOrder] Job insert failed for line item ${li.id}:`, jobErr?.message)
      continue
    }
    console.log('[convertToSalesOrder] Created Job:', newJob.id, 'for line item', li.id)
    createdJobs.push(newJob as { id: string; job_number: number })
  }

  // Activity log: SO created + quote converted + one entry per job created
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
        to_value: soLabel,
        metadata: { sales_order_id: soId },
      })
      for (const job of createdJobs) {
        await logActivity({
          org_id: orgId,
          user_id: user.id,
          entity_type: 'job',
          entity_id: job.id,
          action: 'created',
          metadata: { job_number: job.job_number, sales_order_id: soId },
        })
      }
    }
  } catch (err) {
    console.error('[convertToSalesOrder] logActivity failed:', err)
  }
  const { error: updateErr } = await service
    .from('quotes')
    .update({ status: 'ordered', converted_to_so_id: soId })
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  let quoteUpdateFailed = false
  if (updateErr) {
    // Fallback: if converted_to_so_id column doesn't exist, just update status
    if (updateErr.message?.includes('does not exist')) {
      const { error: fallbackErr } = await service
        .from('quotes')
        .update({ status: 'ordered' })
        .eq('id', quoteId)
        .eq('organization_id', orgId)
      if (fallbackErr) {
        console.error('[convertToSalesOrder] Fallback quote update also failed:', fallbackErr.message)
        quoteUpdateFailed = true
      }
    } else {
      console.error('[convertToSalesOrder] Quote update failed:', updateErr.message)
      quoteUpdateFailed = true
    }
  }

  // The SO was already created successfully above — it's real and the
  // redirect is correct either way. But if the quote itself never got
  // marked 'ordered', it can still show as open and get converted again,
  // creating a duplicate SO — so that failure must stay visible, not silent.
  if (quoteUpdateFailed) {
    redirect(`/dashboard/${orgSlug}/sales-orders/${soId}?warning=${encodeURIComponent('Sales order created, but the source quote could not be marked as converted — it may still show as open.')}`)
  }

  redirect(`/dashboard/${orgSlug}/sales-orders/${soId}`)
}

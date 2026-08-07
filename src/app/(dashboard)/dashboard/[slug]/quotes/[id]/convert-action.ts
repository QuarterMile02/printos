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

  // Resolve departments from quote products (non-fatal)
  let upcomingDepartments: string[] = []
  let primaryDepartment: string | null = null
  try {
    upcomingDepartments = await resolveJobDepartments(quoteId, orgId, service)
    if (upcomingDepartments.length === 1) primaryDepartment = upcomingDepartments[0]
  } catch (err) {
    console.error('[convertToSalesOrder] resolveJobDepartments failed:', err)
  }

  // Create job linked to this SO. Sets BOTH sales_order_id and
  // source_quote_id -- found live via an end-to-end proof-send test that
  // this insert only ever set sales_order_id, while every read site
  // (jobs/[jobId]/page.tsx's SO/quote breadcrumb lookup, this SO page's
  // own Jobs section below, and the new proof-send "ready proofs" query)
  // looks jobs up by source_quote_id. Result: the Jobs section on every
  // SO's detail page has been showing "No jobs created yet" for every SO
  // ever created through this flow -- confirmed against production, all
  // 6 existing jobs have source_quote_id = null. Setting both here is the
  // minimal fix: it satisfies the existing source_quote_id convention
  // without having to touch every read site, and doesn't require a
  // backfill for this fix to take effect for new jobs going forward.
  const { data: newJob, error: jobErr } = await service
    .from('jobs')
    .insert({
      organization_id: orgId,
      sales_order_id: soId,
      source_quote_id: quoteId,
      customer_id: (quote as Record<string, unknown>).customer_id as string | null,
      title: `Job for SO-${String(soNumber).padStart(4, '0')}`,
      status: 'new',
      proof_status: 'not_started',
      proof_due_date: calculateProofDueDate(new Date()).toISOString(),
      upcoming_departments: upcomingDepartments,
      department: primaryDepartment,
    })
    .select('id, job_number')
    .single()

  if (jobErr) {
    console.error('[convertToSalesOrder] Job insert failed:', jobErr.message)
  } else {
    console.log('[convertToSalesOrder] Created Job:', (newJob as Record<string, unknown>).id)
  }

  // Activity log: SO created + quote converted + job created
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
      if (!jobErr && newJob) {
        const jobId = (newJob as Record<string, unknown>).id as string
        const jobNumber = (newJob as Record<string, unknown>).job_number as number
        await logActivity({
          org_id: orgId,
          user_id: user.id,
          entity_type: 'job',
          entity_id: jobId,
          action: 'created',
          metadata: { job_number: jobNumber, sales_order_id: soId },
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

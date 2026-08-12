'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { JobStatus, JobFlag, OrgRole } from '@/types/database'
import { getEmailTemplate, renderTemplate } from '@/app/actions/get-email-template'
import { getSignatureHtmlForUser } from '@/app/actions/email-signature'
import { logActivity } from '@/lib/logActivity'
import { createInvoiceFromSO } from '@/app/(dashboard)/dashboard/[slug]/invoices/actions'
import { dbOrThrow } from '@/lib/db'
import { SYSTEM_FROM_EMAIL } from '@/lib/email-sender'

function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null
  if (phone.startsWith('+')) return phone
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`
  return `+${digits}`
}

const VALID_STATUSES: JobStatus[] = [
  'new', 'in_progress', 'proof_review', 'ready_for_pickup', 'completed',
]

async function getMembership(orgId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, membership: null }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  return { user, membership }
}

export async function createJob(
  orgId: string,
  orgSlug: string,
  formData: FormData
): Promise<{ error?: string }> {
  const title = (formData.get('title') as string | null)?.trim()
  const customerId = (formData.get('customer_id') as string | null) || null
  const description = (formData.get('description') as string | null)?.trim() || null
  const dueDate = (formData.get('due_date') as string | null) || null
  const status = ((formData.get('status') as string | null) ?? 'new') as JobStatus

  if (!title) return { error: 'Title is required.' }
  if (!VALID_STATUSES.includes(status)) return { error: 'Invalid status.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create jobs.' }

  const service = createServiceClient()
  const { error: insertError } = await service
    .from('jobs')
    .insert({
      organization_id: orgId,
      customer_id: customerId || null,
      title,
      description,
      status,
      due_date: dueDate || null,
    })

  if (insertError) return { error: insertError.message }

  revalidatePath(`/dashboard/${orgSlug}/jobs`)
  return {}
}

export async function updateJobStatus(
  jobId: string,
  orgId: string,
  orgSlug: string,
  status: JobStatus
): Promise<{ error?: string; notified?: number }> {
  if (!VALID_STATUSES.includes(status)) return { error: 'Invalid status.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update jobs.' }

  const service = createServiceClient()

  // Read previous status + completed_at for stage events and timestamp logic
  const { data: prev } = await service
    .from('jobs')
    .select('status, completed_at')
    .eq('id', jobId)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { status: JobStatus; completed_at: string | null } | null; error: unknown }

  const prevCompletedAt = prev?.completed_at ?? null
  const updatePayload: { status: JobStatus; completed_at?: string | null } = { status }
  if (status === 'completed') {
    if (!prevCompletedAt) updatePayload.completed_at = new Date().toISOString()
  } else {
    updatePayload.completed_at = null
  }

  const { error: updateError } = await service
    .from('jobs')
    .update(updatePayload)
    .eq('id', jobId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }

  if (prev?.status && prev.status !== status) {
    await logActivity({
      org_id: orgId,
      user_id: user.id,
      entity_type: 'job',
      entity_id: jobId,
      action: 'stage_exited',
      from_value: prev.status,
      to_value: status,
    })
  }
  await logActivity({
    org_id: orgId,
    user_id: user.id,
    entity_type: 'job',
    entity_id: jobId,
    action: 'stage_entered',
    from_value: prev?.status,
    to_value: status,
  })

  // Auto-create invoice when job is marked complete and the linked SO is
  // already completed but has no invoice yet (non-fatal if it fails).
  if (status === 'completed') {
    try {
      const { data: jobData } = await service
        .from('jobs')
        .select('source_quote_id, organization_id')
        .eq('id', jobId)
        .maybeSingle() as { data: { source_quote_id: string | null; organization_id: string } | null; error: unknown }

      if (jobData?.source_quote_id) {
        const { data: soRow } = await service
          .from('sales_orders')
          .select('id, status')
          .eq('quote_id', jobData.source_quote_id)
          .maybeSingle() as { data: { id: string; status: string } | null; error: unknown }

        if (soRow && soRow.status === 'completed') {
          const { data: existingInv } = await service
            .from('invoices')
            .select('id')
            .eq('sales_order_id', soRow.id)
            .maybeSingle()

          if (!existingInv) {
            const { data: orgRow } = await service
              .from('organizations')
              .select('slug')
              .eq('id', jobData.organization_id)
              .maybeSingle() as { data: { slug: string } | null; error: unknown }

            if (orgRow?.slug) {
              await createInvoiceFromSO(soRow.id, orgRow.slug, 30)
            }
          }
        }
      }
    } catch (e) {
      console.error('[updateJobStatus] Auto-invoice failed:', e)
    }
  }

  // Notify customer when job is ready for pickup
  let notifiedJobNumber: number | undefined
  if (status === 'ready_for_pickup') {
    const { data: job } = await service
      .from('jobs')
      .select('job_number, title, customer_id')
      .eq('id', jobId)
      .single() as { data: { job_number: number; title: string; customer_id: string | null } | null; error: unknown }

    if (job?.customer_id) {
      const { data: customer } = await service
        .from('customers')
        .select('first_name, last_name, email, phone')
        .eq('id', job.customer_id)
        .single() as { data: { first_name: string; last_name: string; email: string | null; phone: string | null } | null; error: unknown }

      if (customer) {
        const customerName = `${customer.first_name} ${customer.last_name}`
        let sentEmail = false
        let sentSms = false

        // Email via Resend — use template if available
        if (customer.email && process.env.RESEND_API_KEY) {
          try {
            const templateVars = {
              contact_name: customerName,
              txn_number: `JOB-${String(job.job_number).padStart(4, '0')}`,
              job_name: job.title,
            }
            const template =
              (await getEmailTemplate(orgId, 'order_ready')) ??
              (await getEmailTemplate(orgId, 'order_confirmed'))

            const emailSubject = template
              ? await renderTemplate(template.subject, templateVars)
              : `Your order is ready for pickup! Job #${job.job_number}`

            const emailBodyText = template
              ? await renderTemplate(template.body, templateVars)
              : null

            const emailHtml = emailBodyText
              ? `<div style="font-family: sans-serif; max-width: 600px; white-space: pre-wrap;">${emailBodyText.replace(/\n/g, '<br>')}</div>`
              : `
                  <div style="font-family: sans-serif; max-width: 600px;">
                    <h2 style="color: #1a1a1a;">Your Order is Ready!</h2>
                    <p>Hi ${customerName},</p>
                    <p>Your order is ready for pickup!</p>
                    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                      <tr>
                        <td style="padding: 8px 0; color: #666;">Job</td>
                        <td style="padding: 8px 0; font-weight: 600;">#${job.job_number}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #666;">Title</td>
                        <td style="padding: 8px 0; font-weight: 600;">${job.title}</td>
                      </tr>
                    </table>
                    <p>Please contact us to schedule your pickup.</p>
                    <p style="color: #999; font-size: 0.85em; margin-top: 32px;">Sent via PrintOS</p>
                  </div>
                `

            // Append sender's email signature
            const sigHtml = await getSignatureHtmlForUser(user.id, orgId)
            const finalHtml = emailHtml + sigHtml

            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                // System-triggered notification (status change), not a
                // person composing an email -- system address, not the
                // acting user's identity.
                from: SYSTEM_FROM_EMAIL,
                to: [customer.email],
                subject: emailSubject,
                html: finalHtml,
              }),
            })
            sentEmail = res.ok
          } catch { /* email send failed silently */ }
        }

        // SMS via Twilio
        const { data: orgRow } = await service
          .from('organizations')
          .select('name')
          .eq('id', orgId)
          .single() as { data: { name: string } | null; error: unknown }
        const orgName = orgRow?.name ?? 'us'

        const twilioSid = process.env.TWILIO_ACCOUNT_SID
        const twilioToken = process.env.TWILIO_AUTH_TOKEN
        const twilioFrom = process.env.TWILIO_PHONE_NUMBER
        if (!twilioSid || !twilioToken || !twilioFrom) {
          console.error('[SMS] Missing Twilio env vars — TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER not set')
        } else {
          const toPhone = toE164(customer.phone)
          if (!toPhone) {
            console.error('[SMS] Cannot send — customer phone is empty for customer_id:', job.customer_id)
          } else {
            try {
              const body = `Hi ${customer.first_name}, your order "${job.title}" (Job #${String(job.job_number).padStart(4, '0')}) is ready for pickup at ${orgName}! Call us to schedule.`
              const params = new URLSearchParams({ To: toPhone, From: twilioFrom, Body: body })
              const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
                method: 'POST',
                headers: {
                  'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params.toString(),
              })
              if (!res.ok) {
                const errBody = await res.text()
                console.error('[SMS] Twilio API error:', res.status, errBody)
              }
              sentSms = res.ok
            } catch (smsError) {
              console.error('[SMS] Twilio send failed:', smsError)
            }
          }
        }

        // Log notification
        if (sentEmail || sentSms) {
          const method = sentEmail && sentSms ? 'both' : sentEmail ? 'email' : 'sms'
          await service.from('job_notifications').insert({
            job_id: jobId,
            customer_id: job.customer_id,
            method,
            status: 'sent',
          })
          notifiedJobNumber = job.job_number
        }
      }
    }
  }

  revalidatePath(`/dashboard/${orgSlug}/jobs`)
  return { notified: notifiedJobNumber }
}

export async function updateJobFlag(
  jobId: string,
  orgId: string,
  orgSlug: string,
  flag: JobFlag | null
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update jobs.' }

  const service = createServiceClient()
  const { error: updateError } = await service
    .from('jobs')
    .update({ flag })
    .eq('id', jobId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }

  revalidatePath(`/dashboard/${orgSlug}/jobs`)
  revalidatePath(`/dashboard/${orgSlug}/jobs/${jobId}`)
  return {}
}

const VALID_DEPTS = [
  'large_format', 'commercial_print', 'vehicle_wrap', 'channel_letters',
  'fabrication', 'installation', 'service_repair', 'digital_marketing', 'digital_screens',
] as const

export async function updateJobDepartment(
  jobId: string,
  orgId: string,
  orgSlug: string,
  department: string | null,
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }

  if (department !== null && !(VALID_DEPTS as readonly string[]).includes(department)) {
    return { error: 'Invalid department.' }
  }

  const service = createServiceClient()
  const { error: updateError } = await service
    .from('jobs')
    .update({ department })
    .eq('id', jobId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }

  await logActivity({
    org_id: orgId,
    user_id: user.id,
    entity_type: 'job',
    entity_id: jobId,
    action: 'department_changed',
    to_value: department ?? 'unassigned',
  })

  revalidatePath(`/dashboard/${orgSlug}/jobs`)
  revalidatePath(`/dashboard/${orgSlug}/jobs/${jobId}`)
  return {}
}

export async function toggleWorkflowStep(
  jobId: string,
  orgId: string,
  stepId: string | null,
  stepName: string,
  sortOrder: number,
  checked: boolean,
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }

  const service = createServiceClient()

  if (checked) {
    const { error } = await service
      .from('jobs_workflow_progress')
      .upsert(
        {
          job_id: jobId,
          organization_id: orgId,
          step_id: stepId,
          step_name: stepName,
          sort_order: sortOrder,
          checked_by: user.id,
          checked_at: new Date().toISOString(),
        },
        { onConflict: 'job_id,step_name' },
      )
    if (error) return { error: error.message }
  } else {
    const { error } = await service
      .from('jobs_workflow_progress')
      .delete()
      .eq('job_id', jobId)
      .eq('step_name', stepName)
      .eq('organization_id', orgId)
    if (error) return { error: error.message }
  }

  return {}
}

export async function markLabelPrinted(
  jobId: string,
  orgId: string,
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }

  const service = createServiceClient()
  const { error: updateError } = await service
    .from('jobs')
    .update({ label_printed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }
  return {}
}

export async function updateJobDescription(
  jobId: string,
  orgId: string,
  orgSlug: string,
  description: string
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update jobs.' }

  const service = createServiceClient()
  const { error: updateError } = await service
    .from('jobs')
    .update({ description: description.trim() || null })
    .eq('id', jobId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }

  revalidatePath(`/dashboard/${orgSlug}/jobs/${jobId}`)
  return {}
}

export async function updateJobPhaseDates(formData: FormData): Promise<void> {
  const jobId  = formData.get('jobId')  as string
  const orgId  = formData.get('orgId')  as string
  const orgSlug = formData.get('orgSlug') as string

  const productionDueDate    = (formData.get('production_due_date')    as string | null) || null
  const fabricationDueDate   = (formData.get('fabrication_due_date')   as string | null) || null
  const installationDueDate  = (formData.get('installation_due_date')  as string | null) || null

  const { membership } = await getMembership(orgId)
  if (!membership || membership.role === 'viewer') return

  const service = createServiceClient()
  await dbOrThrow(service
    .from('jobs')
    .update({
      production_due_date:   productionDueDate,
      fabrication_due_date:  fabricationDueDate,
      installation_due_date: installationDueDate,
    })
    .eq('id', jobId)
    .eq('organization_id', orgId))

  revalidatePath(`/dashboard/${orgSlug}/jobs/${jobId}`)
}

export type JobSearchRow = {
  id: string
  job_number: number
  title: string
  due_date: string | null
  department: string | null
  flag: string | null
  customer_id: string | null
  sales_order_id: string | null
  invoice_id: string | null
  quote_line_item_id: string | null
}

// Trigram fuzzy search (migration 127's search_jobs_fuzzy) — replaces the
// plain ILIKE-across-searchColumns path (SEARCH_COLUMNS = ['title']).
// Scoped to `title` only, matching the existing search exactly — jobs has
// no denormalized customer-name column to search by (customer_id is a bare
// FK), so that stays out of scope here, same as before.
export async function searchJobs(
  orgId: string,
  term: string,
): Promise<JobSearchRow[]> {
  const cleaned = term.trim()
  if (cleaned.length < 2) return []

  const service = createServiceClient()
  const { data, error } = await service.rpc('search_jobs_fuzzy', {
    p_org_id: orgId,
    p_term: cleaned,
  }) as { data: JobSearchRow[] | null; error: { message: string } | null }

  if (error) {
    console.error('[searchJobs]', error.message)
    return []
  }
  return data ?? []
}

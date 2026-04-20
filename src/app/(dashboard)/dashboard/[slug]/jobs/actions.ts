'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { JobStatus, JobFlag, OrgRole } from '@/types/database'
import { getEmailTemplate, renderTemplate } from '@/app/actions/get-email-template'
import { getSignatureHtml } from '@/app/actions/email-signature'
import { logActivity } from '@/lib/logActivity'

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

  // Read previous status for stage_exited/stage_entered events
  const { data: prev } = await service
    .from('jobs')
    .select('status')
    .eq('id', jobId)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { status: JobStatus } | null; error: unknown }

  const { error: updateError } = await service
    .from('jobs')
    .update({ status })
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
            const template = await getEmailTemplate(orgId, 'order_ready')

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
            const sigHtml = await getSignatureHtml(user.id, orgId)
            const finalHtml = emailHtml + sigHtml

            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: process.env.RESEND_FROM_EMAIL ?? 'PrintOS <noreply@printos.app>',
                to: [customer.email],
                subject: emailSubject,
                html: finalHtml,
              }),
            })
            sentEmail = res.ok
          } catch { /* email send failed silently */ }
        }

        // SMS via Twilio
        if (customer.phone && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
          try {
            const sid = process.env.TWILIO_ACCOUNT_SID
            const token = process.env.TWILIO_AUTH_TOKEN
            const from = process.env.TWILIO_PHONE_NUMBER
            const body = `Hi ${customerName}, your order "${job.title}" (Job #${job.job_number}) is ready for pickup! Call us to schedule.`

            const params = new URLSearchParams({ To: customer.phone, From: from, Body: body })
            const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params.toString(),
            })
            sentSms = res.ok
          } catch { /* sms send failed silently */ }
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

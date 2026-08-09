'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserSenderIdentity, SYSTEM_FROM_EMAIL } from '@/lib/email-sender'
import { getSignatureHtmlForUser } from '@/app/actions/email-signature'
import { logActivity } from '@/lib/logActivity'
import { uploadProofCore } from '@/lib/proofs/upload-proof-core'
import { resolveJobsForLineItems } from '@/lib/jobs/resolve-jobs-for-line-items'

type SendProofsResult = { success: boolean; error?: string; sentCount?: number }
type UploadProofResult = { success: boolean; error?: string }

// Item 2 — upload a proof for one specific line item directly from the SO
// page, without navigating into the job page. Only possible cleanly since
// migration 121's job-per-line-item grain: resolving "the job for this
// line item under this SO" is now unambiguous (at most one match), where
// before one job could hold every line item on the SO and there'd be no
// single right answer. Reuses the exact same upload logic
// (uploadProofCore) as the job page's own upload form -- this is the
// second caller that extraction was for.
export async function uploadProofForLineItem(
  soId: string,
  orgId: string,
  orgSlug: string,
  lineItemId: string,
  file: File,
): Promise<UploadProofResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const service = createServiceClient()

  // Defense in depth beyond RLS, same reasoning as sendProofsBundle below
  // -- this whole action runs on the service-role client.
  const { data: member } = await service
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }
  if (!member || member.role === 'viewer') {
    return { success: false, error: 'Not permitted to upload proofs.' }
  }

  // Resolve the one job for this line item under this SO. Never trust a
  // client-supplied jobId (there isn't one in this signature at all, by
  // design) -- always re-derive it server-side from (soId, lineItemId).
  // Falls back to the SO's one legacy (pre-121) job when this line item
  // predates the job-per-line-item grain change — see
  // resolveJobsForLineItems for why that fallback exists.
  const jobMap = await resolveJobsForLineItems(service, orgId, soId, [lineItemId])
  const job = jobMap[lineItemId]
  if (!job) {
    return { success: false, error: 'No job found for this line item yet.' }
  }

  const result = await uploadProofCore({ service, orgId, jobId: job.id, quoteLineItemId: lineItemId, uploadedBy: user.id, file })
  if (!result.ok) return { success: false, error: result.error }

  await logActivity({
    org_id: orgId,
    user_id: user.id,
    entity_type: 'proof',
    entity_id: result.proofId,
    action: 'proof_sent',
    metadata: { job_id: job.id, sales_order_id: soId, quote_line_item_id: lineItemId, version: result.versionNumber, file_name: result.fileName },
  })

  return { success: true }
}

// Bulk "Send Proofs" action for the Sales Order detail page: staff check
// off one or more line items with a ready (pending, tagged) proof and
// this bundles them into ONE customer-facing email with ONE review link
// (proof_sends + proof_send_items, migration 119), instead of one email
// per proof. The customer approves/rejects each proof independently once
// on that page — see src/lib/proofs/respond-to-proof-core.ts for that
// side.
export async function sendProofsBundle(
  soId: string,
  orgId: string,
  orgSlug: string,
  proofVersionIds: string[],
): Promise<SendProofsResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const service = createServiceClient()

  // Defense in depth beyond RLS: this whole action runs on the
  // service-role client (needed to insert proof_sends/proof_send_items
  // and to read the customer's contact email regardless of which RLS
  // policies apply to the calling user), so re-check membership + role
  // explicitly rather than relying only on proof_sends' own
  // ps_insert_non_viewers policy, which the service client bypasses.
  const { data: member } = await service
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }
  if (!member || member.role === 'viewer') {
    return { success: false, error: 'Not permitted to send proofs.' }
  }

  if (!proofVersionIds || proofVersionIds.length === 0) {
    return { success: false, error: 'Select at least one proof to send.' }
  }

  const { data: so } = await service
    .from('sales_orders')
    .select('id, so_number, quote_id, customer_id, contact_id')
    .eq('id', soId)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { id: string; so_number: number; quote_id: string | null; customer_id: string | null; contact_id: string | null } | null }
  if (!so) return { success: false, error: 'Sales order not found.' }

  // Re-validate every proof id server-side against this SO's own jobs —
  // never trust that a client-supplied list of ids is actually what's
  // shown checked on screen. A tampered payload naming a proof from a
  // different SO (or org) must not slip into this bundle.
  const { data: soJobs } = await service
    .from('jobs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('source_quote_id', so.quote_id ?? '')
  const soJobIds = new Set((soJobs ?? []).map((j) => j.id))

  const { data: proofRows } = await service
    .from('proof_versions')
    .select('id, organization_id, job_id, status, quote_line_item_id')
    .in('id', proofVersionIds) as {
      data: { id: string; organization_id: string; job_id: string; status: string; quote_line_item_id: string | null }[] | null
    }
  const validIds = (proofRows ?? [])
    .filter((p) => p.organization_id === orgId && p.status === 'pending' && p.quote_line_item_id && soJobIds.has(p.job_id))
    .map((p) => p.id)

  if (validIds.length === 0) {
    return { success: false, error: 'None of the selected proofs are valid to send.' }
  }

  // Resolve customer recipient server-side — never trust a client-passed
  // email address for something this sensitive (who gets the review link).
  let recipientEmail: string | null = null
  let recipientName: string | null = null
  if (so.contact_id) {
    const { data: contact } = await service
      .from('customer_contacts')
      .select('full_name, email')
      .eq('id', so.contact_id)
      .maybeSingle() as { data: { full_name: string | null; email: string | null } | null }
    recipientEmail = contact?.email ?? null
    recipientName = contact?.full_name ?? null
  }
  if (!recipientEmail && so.customer_id) {
    const { data: cust } = await service
      .from('customers')
      .select('first_name, last_name, company_name, email')
      .eq('id', so.customer_id)
      .maybeSingle() as { data: { first_name: string | null; last_name: string | null; company_name: string | null; email: string | null } | null }
    recipientEmail = cust?.email ?? null
    recipientName = cust ? ([cust.first_name, cust.last_name].filter(Boolean).join(' ').trim() || cust.company_name) : null
  }
  if (!recipientEmail) {
    return { success: false, error: 'No customer email on file for this sales order.' }
  }

  // Create the send + its items
  const { data: sendRow, error: sendErr } = await service
    .from('proof_sends')
    .insert({ organization_id: orgId, sales_order_id: soId, sent_by: user.id })
    .select('id, token')
    .single() as { data: { id: string; token: string } | null; error: { message: string } | null }
  if (sendErr || !sendRow) {
    console.error('[sendProofsBundle] proof_sends insert failed:', sendErr?.message)
    return { success: false, error: 'Failed to create the proof send.' }
  }

  const { error: itemsErr } = await service
    .from('proof_send_items')
    .insert(validIds.map((id) => ({ proof_send_id: sendRow.id, proof_version_id: id, organization_id: orgId })))
  if (itemsErr) {
    console.error('[sendProofsBundle] proof_send_items insert failed:', itemsErr.message)
    return { success: false, error: 'Failed to attach proofs to the send.' }
  }

  // Email
  const reviewUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://printos-lemon.vercel.app'}/proofs/${sendRow.token}`
  const soLabel = `SO-${String(so.so_number).padStart(4, '0')}`
  const count = validIds.length

  const emailHtml = `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2 style="color: #1a1a1a;">Proof${count === 1 ? '' : 's'} ready for your review</h2>
      <p>Hi ${recipientName ?? 'there'},</p>
      <p>${count} proof${count === 1 ? ' is' : 's are'} ready for your review on ${soLabel}. Please review and approve or reject ${count === 1 ? 'it' : 'each one'} using the link below.</p>
      <p style="margin: 24px 0;">
        <a href="${reviewUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Review Proofs</a>
      </p>
      <p style="color:#999;font-size:0.85em;">If the button doesn't work, copy and paste this link: ${reviewUrl}</p>
    </div>
  `.trim()

  const fromHeader = user.email ? await getUserSenderIdentity(service, user.id, user.email, orgId) : SYSTEM_FROM_EMAIL
  let sigHtml = ''
  try { sigHtml = await getSignatureHtmlForUser(user.id, orgId) } catch { /* signature optional */ }

  // If the email never goes out, the send shouldn't exist: otherwise the
  // proofs would show as "Sent Xh ago" on the SO page (and be excluded
  // from re-send consideration) despite the customer never having
  // received a link at all -- a phantom-send state, the same class of
  // "state says sent, reality says no" gap flagged in the invoice IIF
  // export work earlier. proof_send_items cascade-deletes with its parent
  // proof_sends row (migration 119's ON DELETE CASCADE), so deleting just
  // the send is enough to fully roll back.
  async function rollbackSend(reason: string) {
    console.error(`[sendProofsBundle] ${reason} — rolling back send ${sendRow!.id}`)
    await service.from('proof_sends').delete().eq('id', sendRow!.id)
  }

  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromHeader, to: [recipientEmail], subject: `Proofs ready for your review — ${soLabel}`, html: emailHtml + sigHtml }),
      })
      if (!res.ok) {
        const body = await res.text()
        await rollbackSend(`Resend error: ${body}`)
        return { success: false, error: 'Failed to send the email. Nothing was recorded — try again.' }
      }
    } catch (err) {
      await rollbackSend(`Email send threw: ${err instanceof Error ? err.message : String(err)}`)
      return { success: false, error: 'Failed to send the email. Nothing was recorded — try again.' }
    }
  } else {
    await rollbackSend('RESEND_API_KEY not configured')
    return { success: false, error: 'Email delivery is not configured.' }
  }

  await logActivity({
    org_id: orgId,
    user_id: user.id,
    entity_type: 'proof',
    entity_id: sendRow.id,
    action: 'proof_sent',
    metadata: { sales_order_id: soId, proof_version_ids: validIds, recipient_email: recipientEmail },
  })

  return { success: true, sentCount: count }
}

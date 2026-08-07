import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { buildInvoicesIif, markInvoicesIifExported } from '@/lib/iif/build-invoices-iif'
import { SYSTEM_FROM_EMAIL } from '@/lib/email-sender'

export const dynamic = 'force-dynamic'

// Scheduled replacement for manually clicking "Post to Accounting" ->
// selecting invoices -> downloading the bulk IIF export. Runs once daily
// (see vercel.json — Hobby-plan Cron can't do per-org precise times, see
// migration 118's comments) and, for every org that has opted in via
// Settings > Accounting, emails whatever invoices are currently unposted
// as an IIF attachment to their configured recipient.
//
// Deliberately does NOT mark invoices posted (is_posted stays false) --
// confirmed with Ruben: the email is purely a delivery mechanism, not a
// confirmation that the file was actually imported into QuickBooks.
// Posting stays a distinct, manual, deliberate action via the existing
// /dashboard/[slug]/accounting page, same as today. That also makes this
// job naturally safe to fire repeatedly: an org's still-unposted invoices
// simply get re-sent on the next run, nothing is silently skipped or
// double-counted because of this job's own state.

type AcctSettingsRow = {
  organization_id: string
  iif_export_enabled: boolean
  iif_export_recipient_email: string | null
}

type OrgRow = { id: string; slug: string; name: string }

type InvoiceIdRow = { id: string }

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  // Fail closed: if the secret isn't configured, refuse to run rather than
  // accepting unauthenticated requests. Vercel Cron automatically sends
  // `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set as a
  // project env var, matching this check.
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('[cron/invoice-iif-export] RESEND_API_KEY not configured — skipping run')
    return NextResponse.json({ error: 'Email delivery not configured' }, { status: 500 })
  }

  const service = createServiceClient()
  const results: Array<{ orgId: string; orgSlug: string; sent: boolean; invoiceCount?: number; error?: string }> = []

  try {
    const { data: settingsRows, error: settingsErr } = await service
      .from('accounting_settings')
      .select('organization_id, iif_export_enabled, iif_export_recipient_email')
      .eq('iif_export_enabled', true)
      .not('iif_export_recipient_email', 'is', null) as { data: AcctSettingsRow[] | null; error: unknown }
    if (settingsErr) throw new Error(`accounting_settings fetch: ${settingsErr instanceof Error ? settingsErr.message : String(settingsErr)}`)

    const enabledOrgs = (settingsRows ?? []).filter(r => r.iif_export_recipient_email?.trim())
    if (enabledOrgs.length === 0) {
      return NextResponse.json({ message: 'No organizations have scheduled IIF export enabled', results: [] })
    }

    const orgIds = enabledOrgs.map(r => r.organization_id)
    const { data: orgRows, error: orgErr } = await service
      .from('organizations')
      .select('id, slug, name')
      .in('id', orgIds) as { data: OrgRow[] | null; error: unknown }
    if (orgErr) throw new Error(`organizations fetch: ${orgErr instanceof Error ? orgErr.message : String(orgErr)}`)
    const orgById = new Map((orgRows ?? []).map(o => [o.id, o]))

    for (const settings of enabledOrgs) {
      const org = orgById.get(settings.organization_id)
      const recipient = settings.iif_export_recipient_email!.trim()
      if (!org) {
        results.push({ orgId: settings.organization_id, orgSlug: '(unknown)', sent: false, error: 'Organization not found' })
        continue
      }

      try {
        // Same "unposted invoices" query the manual Post to Accounting
        // page already uses.
        const { data: invRows, error: invErr } = await service
          .from('invoices')
          .select('id')
          .eq('organization_id', org.id)
          .eq('is_posted', false) as { data: InvoiceIdRow[] | null; error: unknown }
        if (invErr) throw new Error(`invoices fetch: ${invErr instanceof Error ? invErr.message : String(invErr)}`)

        const invoiceIds = (invRows ?? []).map(r => r.id)
        if (invoiceIds.length === 0) {
          results.push({ orgId: org.id, orgSlug: org.slug, sent: false, invoiceCount: 0 })
          continue
        }

        const built = await buildInvoicesIif(service, org.id, invoiceIds)
        if (built.error || !built.result) throw new Error(built.error ?? 'IIF generation failed')

        const { iifBody, filename, invoiceCount, invoiceIds: builtInvoiceIds, newInvoiceNumbers, repeatInvoiceNumbers } = built.result
        const previewList = (nums: string[]) => nums.slice(0, 25).join(', ') + (nums.length > 25 ? `, +${nums.length - 25} more` : '')
        // Repeat-send safeguard (migration 120): an invoice re-appears here
        // whenever it wasn't promptly marked posted after a prior day's
        // export, since posting stays a manual step and this job just
        // re-queries "still unposted" every run. Split so whoever's
        // importing can tell at a glance which invoices they've already
        // seen before -- QuickBooks Desktop's IIF import won't catch a
        // re-import itself (see migration 120's header comment).
        const newSection = newInvoiceNumbers.length > 0 ? `
            <p style="margin:12px 0 4px;"><strong>New (${newInvoiceNumbers.length}):</strong></p>
            <p style="color:#555;font-size:13px;">${previewList(newInvoiceNumbers)}</p>` : ''
        const repeatSection = repeatInvoiceNumbers.length > 0 ? `
            <p style="margin:12px 0 4px;color:#b45309;"><strong>⚠ Repeat — confirm not already imported (${repeatInvoiceNumbers.length}):</strong></p>
            <p style="color:#b45309;font-size:13px;">${previewList(repeatInvoiceNumbers)}</p>` : ''
        const html = `
          <div style="font-family: sans-serif; max-width: 600px;">
            <p>Attached is today's automated QuickBooks IIF export for <strong>${org.name}</strong> —
            <strong>${invoiceCount}</strong> unposted invoice${invoiceCount === 1 ? '' : 's'}.</p>
            ${newSection}
            ${repeatSection}
            <p>Import this file into QuickBooks Desktop (File → Utilities → Import → IIF Files), then mark
            these invoices posted in PrintOS under Settings → Post to Accounting once confirmed.</p>
            <p style="color:#888;font-size:12px;">This is an automated message from PrintOS — the export
            was not marked posted automatically; posting is still a manual step. Repeat invoices above are
            marked "[REPEAT EXPORT]" in the IIF file's memo field too.</p>
          </div>
        `.trim()

        const emailPayload = {
          from: SYSTEM_FROM_EMAIL,
          to: [recipient],
          subject: `PrintOS Invoice Export — ${new Date().toISOString().slice(0, 10)} (${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'})`,
          html,
          attachments: [{ filename, content: Buffer.from(iifBody, 'utf8').toString('base64') }],
        }

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailPayload),
        })
        if (!res.ok) {
          const errBody = await res.text()
          throw new Error(`Resend API error: ${res.status} ${errBody}`)
        }

        await service
          .from('accounting_settings')
          .update({ iif_export_last_sent_at: new Date().toISOString() })
          .eq('organization_id', org.id)

        // Only mark exported after Resend has actually confirmed the send
        // (this line is unreachable otherwise — the throw above on a
        // non-ok response exits the try block first) — a failed send must
        // not get falsely counted as a repeat-flaggable prior export.
        await markInvoicesIifExported(service, builtInvoiceIds)

        results.push({ orgId: org.id, orgSlug: org.slug, sent: true, invoiceCount })
      } catch (err) {
        console.error(`[cron/invoice-iif-export] Failed for org ${org.slug}:`, err)
        results.push({ orgId: org.id, orgSlug: org.slug, sent: false, error: err instanceof Error ? err.message : String(err) })
      }
    }

    return NextResponse.json({ results })
  } catch (err) {
    console.error('[cron/invoice-iif-export] Fatal error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}

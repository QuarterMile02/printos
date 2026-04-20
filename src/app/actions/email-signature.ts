'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'

export type SignatureFields = {
  sig_full_name: string
  sig_title: string
  sig_phone: string
  sig_mobile: string
  sig_address: string
}

export type SignatureRow = SignatureFields & {
  body: string
  is_html: boolean
}

export async function getEmailSignature(
  orgId: string,
): Promise<SignatureRow | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const service = createServiceClient()
  const { data } = await service
    .from('email_signatures')
    .select('body, is_html, sig_full_name, sig_title, sig_phone, sig_mobile, sig_address')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!data) return null
  return data as SignatureRow
}

// Regenerate the contact info section in the locked v32 signature HTML.
// Replaces the content inside <div style="flex:1;">...</div> — everything
// after the logo <img> and before the services footer <div class="sf">.
function regenerateContactHtml(
  existingBody: string,
  fields: SignatureFields,
): string {
  // Build the new contact block
  const phoneLine = [
    fields.sig_phone ? `P: ${fields.sig_phone}` : '',
    fields.sig_mobile ? `M: ${fields.sig_mobile}` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ')

  const contactBlock = `<div style="flex:1;">
      <p class="sn">${escapeHtml(fields.sig_full_name)}</p>
      <p class="st">${escapeHtml(fields.sig_title)}</p>
      <div class="sd"></div>
      ${phoneLine ? `<p class="sc">${phoneLine}</p>` : ''}
      ${fields.sig_address ? `<p class="sc">${escapeHtml(fields.sig_address)}</p>` : ''}
      <p class="sc"><a href="https://www.QuarterMileInc.com">www.QuarterMileInc.com</a></p>
    </div>`

  // Replace the existing contact block (between the logo img closing tag and the services footer)
  // Pattern: <div style="flex:1;">...anything...</div>\n  </div>\n  <div class="sf">
  const regex = /<div style="flex:1;">[\s\S]*?<\/div>\s*<\/div>\s*<div class="sf">/
  if (regex.test(existingBody)) {
    return existingBody.replace(regex, `${contactBlock}\n  </div>\n  <div class="sf">`)
  }

  // Fallback: if regex doesn't match, return existing body unchanged
  return existingBody
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function saveEmailSignatureFields(
  orgId: string,
  fields: SignatureFields,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const service = createServiceClient()

  // Fetch existing row to get the current body HTML (with logo)
  const { data: existing } = await service
    .from('email_signatures')
    .select('body')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { body: string } | null; error: unknown }

  if (!existing) {
    return { error: 'No signature found. Please contact your administrator to set up your signature.' }
  }

  // Regenerate the body HTML with the new contact info
  const newBody = regenerateContactHtml(existing.body, fields)

  const { error } = await service
    .from('email_signatures')
    .update({
      body: newBody,
      sig_full_name: fields.sig_full_name,
      sig_title: fields.sig_title,
      sig_phone: fields.sig_phone,
      sig_mobile: fields.sig_mobile,
      sig_address: fields.sig_address,
    })
    .eq('user_id', user.id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  return {}
}

// Helper for send actions — fetches signature and returns HTML snippet
// to append. Returns empty string if no signature exists or table is
// missing. Caller already has userId from their own auth check.
export async function getSignatureHtml(
  userId: string,
  orgId: string,
): Promise<string> {
  try {
    console.log('[getSignatureHtml] lookup:', { userId, orgId })
    const service = createServiceClient()
    const { data, error } = await service
      .from('email_signatures')
      .select('body, is_html')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (error) {
      console.error('[getSignatureHtml] query error:', error.message)
      return ''
    }
    if (!data) {
      console.log('[getSignatureHtml] no signature found')
      return ''
    }
    const row = data as { body: string; is_html: boolean }
    if (!row.body.trim()) {
      console.log('[getSignatureHtml] signature body is empty')
      return ''
    }

    console.log('[getSignatureHtml] found signature, length:', row.body.length, 'is_html:', row.is_html)

    if (row.is_html) {
      return `<br><br>--<br>${row.body}`
    }
    // Plain text signature — wrap in pre-wrap div
    const escaped = row.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
    return `<br><br>--<br><div style="white-space:pre-wrap;">${escaped}</div>`
  } catch (err) {
    console.error('[getSignatureHtml] caught exception:', err instanceof Error ? err.message : String(err))
    return ''
  }
}

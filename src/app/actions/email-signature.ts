'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { buildSignatureHtml } from '@/lib/email-signature-template'

// Builds the signature for outgoing emails from the sending user's own
// profile fields (name/title/phone/mobile), live at send time. The visual
// template itself is locked/shared — see src/lib/email-signature-template.ts.
export async function getSignatureHtmlForUser(
  userId: string,
  orgId: string,
): Promise<string> {
  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('profiles')
      .select('full_name, title, phone, mobile')
      .eq('id', userId)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (error) {
      console.error('[getSignatureHtmlForUser] query error:', error.message)
      return ''
    }
    if (!data) {
      console.log('[getSignatureHtmlForUser] no profile found')
      return ''
    }

    const row = data as { full_name: string; title: string | null; phone: string | null; mobile: string | null }
    const sigHtml = buildSignatureHtml({
      fullName: row.full_name,
      title: row.title,
      phone: row.phone,
      mobile: row.mobile,
    })
    return `<br><br>--<br>${sigHtml}`
  } catch (err) {
    console.error('[getSignatureHtmlForUser] caught exception:', err instanceof Error ? err.message : String(err))
    return ''
  }
}

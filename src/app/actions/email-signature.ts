'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function getEmailSignature(
  orgId: string,
): Promise<{ body: string; is_html: boolean } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const service = createServiceClient()
  const { data } = await service
    .from('email_signatures')
    .select('body, is_html')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!data) return null
  const row = data as { body: string; is_html: boolean }
  return { body: row.body, is_html: row.is_html }
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

export async function saveEmailSignature(
  orgId: string,
  body: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const service = createServiceClient()
  const { error } = await service
    .from('email_signatures')
    .upsert(
      {
        user_id: user.id,
        organization_id: orgId,
        body,
        is_html: true,
      },
      { onConflict: 'user_id,organization_id' },
    )

  if (error) return { error: error.message }
  return {}
}

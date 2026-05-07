import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'

// POST /api/quotes/approve
// Body: { quote_id, organization_id }
// Sets quote.status = 'approved'. If needs_manager_approval column
// exists, also flips it to false. Owner / sales-manager only.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const orgId = body.organization_id as string | undefined
  const quoteId = body.quote_id as string | undefined
  if (!orgId || !quoteId) return NextResponse.json({ error: 'quote_id, organization_id required' }, { status: 400 })

  const { allowed } = await checkPermission(orgId, 'quotes.see_pricing')
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const service = createServiceClient()
  // Try the rich update first (with needs_manager_approval). If the column
  // doesn't exist, fall back to status-only update.
  let updateError: { message: string } | null = null
  {
    const r = await service
      .from('quotes')
      .update({ status: 'approved', needs_manager_approval: false })
      .eq('id', quoteId)
      .eq('organization_id', orgId)
    if (r.error) updateError = r.error
  }
  if (updateError && /column .*needs_manager_approval.* does not exist/i.test(updateError.message)) {
    const r = await service
      .from('quotes')
      .update({ status: 'approved' })
      .eq('id', quoteId)
      .eq('organization_id', orgId)
    if (r.error) {
      console.error('[api/quotes/approve] fallback failed:', r.error)
      return NextResponse.json({ error: r.error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }
  if (updateError) {
    console.error('[api/quotes/approve] update failed:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

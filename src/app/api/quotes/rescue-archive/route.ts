import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'

// POST /api/quotes/rescue-archive
// Body: { quote_id, organization_id }
// Removes a quote from the rescue list by setting rescue_flag = false
// (if the column exists). If rescue_flag isn't in the schema, this
// route is a no-op success — the rescue widget will fall back to a
// status-based filter that already excludes archived rows the same
// way it filters today.
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
  const r = await service
    .from('quotes')
    .update({ rescue_flag: false })
    .eq('id', quoteId)
    .eq('organization_id', orgId)
  if (r.error && !/column .*rescue_flag.* does not exist/i.test(r.error.message)) {
    console.error('[api/quotes/rescue-archive] update failed:', r.error)
    return NextResponse.json({ error: r.error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

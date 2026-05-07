import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// POST /api/collection-calls
// Body: { organization_id, customer_id, outcome, promise_date?, notes? }
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const orgId = body.organization_id as string | undefined
  const customerId = body.customer_id as string | undefined
  const outcome = body.outcome as string | undefined

  if (!orgId || !customerId || !outcome) {
    return NextResponse.json({ error: 'organization_id, customer_id, outcome required' }, { status: 400 })
  }

  const promiseDate = body.promise_date as string | null | undefined
  const notes = body.notes as string | null | undefined

  const service = createServiceClient()
  const { data, error } = await service
    .from('collection_call_logs')
    .insert({
      organization_id: orgId,
      customer_id: customerId,
      logged_by: user.id,
      outcome,
      promise_date: promiseDate || null,
      notes: notes || null,
    })
    .select('id, logged_at')
    .single()

  if (error) {
    console.error('[api/collection-calls] insert failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ id: (data as { id: string } | null)?.id, ok: true })
}

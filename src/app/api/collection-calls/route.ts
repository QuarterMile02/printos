import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/logActivity'

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

  // Both organization_id and customer_id arrive from the request body and
  // the insert below runs on a service-role client, which bypasses RLS.
  // Until now the only gate was "is anyone logged in", so any authenticated
  // user could write a collection call into ANY org, against ANY customer
  // id. Two checks, in order:
  //
  //   1. Does the CALLER belong to the org they named? Resolved from
  //      organization_members against the supplied orgId -- the same shape
  //      products/bulk-import-shopvox uses, and deliberately not
  //      checkPermission(), which answers "does this role hold this
  //      permission key", a different question from "is this your org".
  //   2. Does the CUSTOMER belong to that same org? Membership alone
  //      doesn't stop a member of org A writing against org B's customer
  //      id -- the row would land in org A carrying a foreign customer_id,
  //      and logActivity below would file it under that customer too.
  //
  // Both use the caller's own RLS-scoped client for the membership read,
  // and the service client only after both have passed.
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const service = createServiceClient()

  const { data: customerRow } = await service
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { id: string } | null; error: unknown }
  if (!customerRow) {
    // Same 403 as a failed membership check, deliberately: "this customer
    // is in another org" and "this customer doesn't exist" must not be
    // distinguishable from outside, or this becomes a cross-org customer-id
    // probe.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  // Gap closure (migration 132/133 follow-up): this write never reached
  // activity_log before — collection calls were invisible to the
  // Recent Activity widget and any future customer-level audit view.
  // entity_type: 'customer' is correct here, not a placeholder — a
  // collection call is a customer-relationship event, not tied to one
  // invoice/order (collection_call_logs has no invoice_id/sales_order_id
  // column, and CollectionCallForm never receives one). order_thread_id
  // is deliberately left unset: there's no order to anchor it to, so it
  // won't appear in the centralized order-thread view or the embedded
  // per-entity panels (those are quote/sales_order/job/invoice only) —
  // only in the org-wide Recent Activity feed. That's a real scope
  // limit of the current data model, not an oversight here.
  const callId = (data as { id: string } | null)?.id
  if (callId) {
    await logActivity({
      org_id: orgId,
      user_id: user.id,
      entity_type: 'customer',
      entity_id: customerId,
      action: 'collection_call_logged',
      to_value: outcome,
      metadata: { collection_call_log_id: callId, promise_date: promiseDate || null, notes: notes || null },
    })
  }

  return NextResponse.json({ id: callId, ok: true })
}

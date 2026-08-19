import { NextRequest, NextResponse } from 'next/server'
import { createInvoiceFromSO } from '@/app/(dashboard)/dashboard/[slug]/invoices/actions'
import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { userBelongsToOrg } from '@/lib/require-org-access'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { sales_order_id?: string; org_slug?: string; due_days?: number }
    const { sales_order_id, org_slug, due_days = 30 } = body

    if (!sales_order_id || !org_slug) {
      return NextResponse.json({ error: 'sales_order_id and org_slug are required' }, { status: 400 })
    }

    // Auth gate -- this was the only WRITE on the route and had NONE
    // (confirmed live: an unauthenticated request with just org_slug +
    // sales_order_id created a real invoice). org_slug is client-supplied,
    // so resolve it to an id and require BOTH that the caller is actually
    // a member of that org (not merely that some role of theirs allows
    // 'invoices.create' somewhere -- see require-org-access.ts) and that
    // their role/tier has the invoices.create permission.
    const service = createServiceClient()
    const { data: org } = await service.from('organizations').select('id').eq('slug', org_slug).maybeSingle()
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }
    const orgId = (org as { id: string }).id
    const [isMember, { allowed }] = await Promise.all([
      userBelongsToOrg(orgId),
      checkPermission(orgId, 'invoices.create'),
    ])
    if (!isMember || !allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const invoiceId = await createInvoiceFromSO(sales_order_id, org_slug, due_days)
    return NextResponse.json({ id: invoiceId })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

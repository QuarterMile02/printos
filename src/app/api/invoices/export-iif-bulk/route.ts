import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { buildInvoicesIif, markInvoicesIifExported } from '@/lib/iif/build-invoices-iif'
import { checkPermission } from '@/lib/check-permission'
import { userBelongsToOrg } from '@/lib/require-org-access'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { invoiceIds?: string[]; organizationId?: string }
    const { invoiceIds, organizationId } = body

    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return NextResponse.json({ error: 'invoiceIds must be a non-empty array' }, { status: 400 })
    }
    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Bulk sibling of GET /api/invoices/[id]/export-iif -- had the exact
    // same gap (no auth at all) plus organizationId taken straight from
    // the request body and trusted to scope the query. Same gate as that
    // route (invoices.qb_export), plus an explicit membership check since
    // checkPermission alone doesn't verify the caller belongs to
    // organizationId (see require-org-access.ts).
    const [isMember, { allowed }] = await Promise.all([
      userBelongsToOrg(organizationId),
      checkPermission(organizationId, 'invoices.qb_export'),
    ])
    if (!isMember || !allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const service = createServiceClient()
    const built = await buildInvoicesIif(service, organizationId, invoiceIds)
    if (built.error || !built.result) {
      const status = built.error === 'No matching invoices found' ? 404 : 500
      return NextResponse.json({ error: built.error ?? 'IIF generation failed' }, { status })
    }

    // The download response below *is* the delivery for this manual path
    // (unlike the cron route, there's no further async step that could
    // still fail) -- mark exported now, but don't let a marking failure
    // block the file the user is actually waiting on.
    try {
      await markInvoicesIifExported(service, built.result.invoiceIds)
    } catch (err) {
      console.error('[/api/invoices/export-iif-bulk] markInvoicesIifExported failed:', err)
    }

    return new NextResponse(built.result.iifBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${built.result.filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[/api/invoices/export-iif-bulk] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}

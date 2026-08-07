import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { buildInvoicesIif } from '@/lib/iif/build-invoices-iif'

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

    const service = createServiceClient()
    const built = await buildInvoicesIif(service, organizationId, invoiceIds)
    if (built.error || !built.result) {
      const status = built.error === 'No matching invoices found' ? 404 : 500
      return NextResponse.json({ error: built.error ?? 'IIF generation failed' }, { status })
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

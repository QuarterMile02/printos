import { NextRequest, NextResponse } from 'next/server'
import { createInvoiceFromSO } from '@/app/(dashboard)/dashboard/[slug]/invoices/actions'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { sales_order_id?: string; org_slug?: string; due_days?: number }
    const { sales_order_id, org_slug, due_days = 30 } = body

    if (!sales_order_id || !org_slug) {
      return NextResponse.json({ error: 'sales_order_id and org_slug are required' }, { status: 400 })
    }

    const invoiceId = await createInvoiceFromSO(sales_order_id, org_slug, due_days)
    return NextResponse.json({ id: invoiceId })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

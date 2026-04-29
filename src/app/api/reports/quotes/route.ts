// GET /api/reports/quotes — streams the filtered Quotes report as CSV.
// Mirrors the same filters as /dashboard/[slug]/reports/quotes so the
// download matches what the user is seeing.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { resolveDateRange, buildCsv, type DateRangePreset } from '@/lib/reports/report-utils'
import type { QuoteStatus } from '@/types/database'

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const orgId = sp.get('org')
    if (!orgId) return NextResponse.json({ error: 'org param required' }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { allowed: canRunReport } = await checkPermission(orgId, 'reports.quotes')
    if (!canRunReport) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { allowed: canSeePricing } = await checkPermission(orgId, 'quotes.see_pricing')

    const range = resolveDateRange(sp.get('preset') as DateRangePreset | null ?? undefined, sp.get('start') ?? undefined, sp.get('end') ?? undefined)
    const status = sp.get('status') ?? 'all'
    const salesRepId = sp.get('sales_rep') ?? 'all'

    // Service client for read — fetches all rows up to a generous cap.
    const service = createServiceClient()
    let q = service
      .from('quotes')
      .select('id, quote_number, title, status, created_at, total, sales_rep_id, customer_id, customers(first_name, last_name, company_name)')
      .eq('organization_id', orgId)
      .gte('created_at', range.start)
      .lte('created_at', range.end)
      .order('quote_number', { ascending: false })
      .limit(10000)
    if (status && status !== 'all') q = q.eq('status', status)
    if (salesRepId && salesRepId !== 'all') q = q.eq('sales_rep_id', salesRepId)

    type QuoteJoinRow = {
      quote_number: number
      title: string
      status: QuoteStatus
      created_at: string
      total: number | null
      sales_rep_id: string | null
      customers: { first_name: string; last_name: string; company_name: string | null } | null
    }
    const { data: rows, error } = await q as { data: QuoteJoinRow[] | null; error: { message: string } | null }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Resolve sales-rep names in one pass.
    const repIds = Array.from(new Set((rows ?? []).map((r) => r.sales_rep_id).filter(Boolean) as string[]))
    const repNameById = new Map<string, string>()
    if (repIds.length > 0) {
      type ProfileRow = { id: string; full_name: string | null; email: string }
      const { data: profiles } = await service.from('profiles').select('id, full_name, email').in('id', repIds) as { data: ProfileRow[] | null; error: unknown }
      for (const p of profiles ?? []) repNameById.set(p.id, p.full_name || p.email || p.id)
    }

    const headers = ['Quote #', 'Customer', 'Title', 'Status', 'Sales Rep', ...(canSeePricing ? ['Total'] : []), 'Created']
    const csvRows = (rows ?? []).map((r) => {
      const customer = r.customers
        ? r.customers.company_name?.trim() || `${r.customers.first_name} ${r.customers.last_name}`.trim()
        : ''
      const repName = r.sales_rep_id ? repNameById.get(r.sales_rep_id) ?? '' : ''
      const base: (string | number | null)[] = [
        `Q-${String(r.quote_number).padStart(4, '0')}`,
        customer,
        r.title,
        r.status,
        repName,
      ]
      if (canSeePricing) base.push(r.total != null ? (r.total / 100).toFixed(2) : '')
      base.push(r.created_at.slice(0, 10))
      return base
    })

    const body = buildCsv(headers, csvRows)
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="quotes-report-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[/api/reports/quotes] Error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 })
  }
}

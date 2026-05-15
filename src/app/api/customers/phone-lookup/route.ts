import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('q') ?? ''
  const digits = raw.replace(/\D/g, '')

  if (digits.length < 2) return NextResponse.json([])

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  type MembershipRow = { organization_id: string }
  const { data: memberships } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id) as { data: MembershipRow[] | null; error: unknown }

  const orgIds = (memberships ?? []).map((m) => m.organization_id)
  if (orgIds.length === 0) return NextResponse.json([])

  const service = createServiceClient()

  type LookupRow = {
    result_type: string
    id: string
    display_name: string
    company_name: string | null
    phone: string | null
    customer_id: string
    org_slug: string
    status: string | null
    customer_name: string | null
  }

  const { data } = await service.rpc('lookup_by_phone', {
    p_org_ids: orgIds,
    p_digits: digits,
  }) as { data: LookupRow[] | null; error: unknown }

  const results = (data ?? []).map((r) => ({
    id: r.id,
    result_type: r.result_type,
    display_name: r.display_name,
    company_name: r.company_name,
    phone: r.phone,
    customer_id: r.customer_id,
    status: r.status,
    customer_name: r.customer_name,
    url: `/dashboard/${r.org_slug}/customers/${r.customer_id}`,
    // legacy shape kept for backward compat
    first_name: r.display_name.split(' ')[0] ?? '',
    last_name: r.display_name.split(' ').slice(1).join(' ') ?? '',
  }))

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}

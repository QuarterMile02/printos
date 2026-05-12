import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('q') ?? ''
  const allDigits = raw.replace(/\D/g, '')

  // Require at least 7 digits; use last 7 to strip country codes
  if (allDigits.length < 7) return NextResponse.json([])
  const digits = allDigits.slice(-7)

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
  }

  const { data } = await service.rpc('lookup_by_phone', {
    p_org_ids: orgIds,
    p_digits: digits,
  }) as { data: LookupRow[] | null; error: unknown }

  const results = (data ?? []).map((r) => ({
    id: r.id,
    result_type: r.result_type,           // 'customer' | 'contact'
    display_name: r.display_name,
    company_name: r.company_name,
    phone: r.phone,
    customer_id: r.customer_id,
    url: `/dashboard/${r.org_slug}/customers/${r.customer_id}`,
    // legacy shape consumed by PhoneLookup component
    first_name: r.display_name.split(' ')[0] ?? '',
    last_name: r.display_name.split(' ').slice(1).join(' ') ?? '',
  }))

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}

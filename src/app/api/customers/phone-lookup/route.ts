import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

function normalizeDigits(q: string): string {
  return q.replace(/\D/g, '')
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('q') ?? ''
  const digits = normalizeDigits(raw)

  if (digits.length < 4) {
    return NextResponse.json([])
  }

  // Verify the user is authenticated
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get org IDs this user belongs to
  type MembershipRow = { organization_id: string }
  const { data: memberships } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id) as { data: MembershipRow[] | null; error: unknown }

  const orgIds = (memberships ?? []).map((m) => m.organization_id)
  if (orgIds.length === 0) return NextResponse.json([])

  const service = createServiceClient()

  type CustomerRow = {
    id: string
    first_name: string
    last_name: string
    company_name: string | null
    phone: string | null
    organization_id: string
    organizations: { slug: string } | null
  }

  // Search primary phone; use OR filter for secondary_phone if that column exists
  const { data } = await service
    .from('customers')
    .select('id, first_name, last_name, company_name, phone, organization_id, organizations(slug)')
    .in('organization_id', orgIds)
    .ilike('phone', `%${digits}%`)
    .limit(5) as { data: CustomerRow[] | null; error: unknown }

  const results = (data ?? []).map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    company_name: c.company_name,
    phone: c.phone,
    url: c.organizations?.slug
      ? `/dashboard/${c.organizations.slug}/customers/${c.id}`
      : null,
  }))

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

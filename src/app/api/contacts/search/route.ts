import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  const orgSlug = request.nextUrl.searchParams.get('org') ?? ''

  if (!q || q.length < 2) return NextResponse.json([])

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve org slug → id and verify membership
  type OrgRow = { id: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
  if (!org) return NextResponse.json([])

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { organization_id: string } | null; error: unknown }
  if (!membership) return NextResponse.json([])

  const service = createServiceClient()

  type ContactRow = {
    id: string
    full_name: string
    first_name: string | null
    last_name: string | null
    email: string | null
    phone: string | null
    customer_id: string
    customers: { first_name: string; last_name: string; company_name: string | null } | null
  }

  const { data } = await service
    .from('customer_contacts')
    .select('id, full_name, first_name, last_name, email, phone, customer_id, customers(first_name, last_name, company_name)')
    .eq('organization_id', org.id)
    .or(`full_name.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
    .order('last_name', { ascending: true, nullsFirst: false })
    .order('first_name', { ascending: true, nullsFirst: false })
    .limit(50) as { data: ContactRow[] | null; error: unknown }

  const results = (data ?? []).map((c) => {
    const cust = c.customers
    const custName = cust ? `${cust.first_name} ${cust.last_name}`.trim() : null
    return {
      id: c.id,
      full_name: c.full_name,
      email: c.email,
      phone: c.phone,
      customer_id: c.customer_id,
      customer_name: custName,
      company_name: cust?.company_name ?? null,
      customer_url: `/dashboard/${orgSlug}/customers/${c.customer_id}`,
    }
  })

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}

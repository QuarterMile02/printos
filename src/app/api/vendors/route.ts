import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json([], { status: 200 })

  let query = supabase
    .from('vendors')
    .select('id, name, primary_contact, primary_email, primary_phone')
    .eq('organization_id', profile.organization_id)
    .eq('is_active', true)
    .order('name')
    .limit(20)

  if (search.trim()) {
    query = query.ilike('name', `%${search.trim()}%`)
  }

  const { data } = await query
  return NextResponse.json(data ?? [])
}

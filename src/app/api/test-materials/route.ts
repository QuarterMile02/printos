import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data, error } = await supabase
    .from('materials')
    .select('name, cost, active')
    .eq('active', true)
    .limit(5)

  return NextResponse.json({
    count: data?.length ?? 0,
    error: error?.message ?? null,
    first3: data?.slice(0,3).map(m => m.name) ?? [],
    keyPresent: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    keyPrefix: process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0,12) ?? 'MISSING'
  })
}

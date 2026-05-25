import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  // Test 1: no filter
  const { data: all, error: e1 } = await supabase
    .from('materials')
    .select('name, active')
    .limit(3)

  // Test 2: active = true
  const { data: active, error: e2 } = await supabase
    .from('materials')
    .select('name, active')
    .eq('active', true)
    .limit(3)

  return NextResponse.json({
    keyPresent: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    keyPrefix: process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0,15) ?? 'MISSING',
    noFilter: { count: all?.length ?? 0, error: e1?.message ?? null, sample: all?.[0] },
    activeFilter: { count: active?.length ?? 0, error: e2?.message ?? null, sample: active?.[0] }
  })
}

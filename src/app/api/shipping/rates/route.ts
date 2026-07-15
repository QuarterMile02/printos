import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRates } from '@/lib/easypost'
import type { EasypostAddress, EasypostParcel } from '@/lib/easypost'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as {
      to_address: EasypostAddress
      parcel: EasypostParcel
    }
    if (!body.to_address?.zip || !body.parcel?.weight) {
      return NextResponse.json({ error: 'to_address.zip and parcel.weight are required' }, { status: 400 })
    }
    const testMode = process.env.EASYPOST_TEST_API_KEY != null && !process.env.EASYPOST_API_KEY
    const result = await getRates(body.to_address, body.parcel, testMode)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch rates'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

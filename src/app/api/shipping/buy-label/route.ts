import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buyLabel } from '@/lib/easypost'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  const orgId = (profile as { organization_id: string } | null)?.organization_id

  try {
    const body = await req.json() as { easypostShipmentId: string; rateId: string }
    if (!body.easypostShipmentId || !body.rateId) {
      return NextResponse.json({ error: 'easypostShipmentId and rateId are required' }, { status: 400 })
    }
    const result = await buyLabel(body.easypostShipmentId, body.rateId, orgId)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to purchase label'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

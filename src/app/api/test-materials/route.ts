import { NextResponse } from 'next/server'
import { fetchMaterialsForQuote } from '@/app/(dashboard)/dashboard/[slug]/products/[id]/migrate/actions'

export async function GET() {
  const materials = await fetchMaterialsForQuote('test')
  return NextResponse.json({
    count: materials.length,
    first3: materials.slice(0,3).map(m => m.name),
    sample: materials.find(m => m.name?.toLowerCase().includes('epson'))
  })
}

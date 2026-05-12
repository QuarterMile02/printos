import { NextRequest, NextResponse } from 'next/server'
import { getEventsSince } from '@/lib/dialpad-store'

// Polling endpoint — returns events since ?since=<unix_ms>
// IncomingCallToast polls this every 3 s.
export async function GET(request: NextRequest) {
  const sinceParam = request.nextUrl.searchParams.get('since')
  const since = sinceParam ? parseInt(sinceParam, 10) : Date.now() - 35_000

  const events = getEventsSince(since)

  return NextResponse.json(events, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

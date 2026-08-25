import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { pushEvent, type CallEvent } from '@/lib/dialpad-store'

function normalizeDigits(phone: string): string {
  return phone.replace(/\D/g, '')
}

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  // Support both raw hex and "sha256=<hex>" formats
  const candidate = header?.startsWith('sha256=') ? header.slice(7) : (header ?? '')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate.padEnd(expected.length, ' ')))
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // ── Signature verification ──────────────────────────────────────────────────
  // Was fail-OPEN (see webhooks/ghl for the identical issue and the
  // handoff doc) -- an unset DIALPAD_WEBHOOK_SECRET skipped verification
  // instead of refusing the request. Fail closed, matching
  // shipping/webhook and cron/invoice-iif-export.
  const secret = process.env.DIALPAD_WEBHOOK_SECRET
  if (!secret) {
    console.error('[dialpad-webhook] DIALPAD_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }
  const sig = request.headers.get('x-dialpad-signature')
  if (!sig || !verifySignature(rawBody, sig, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Only handle call.started events
  const event = body.event as string | undefined
  if (event !== 'call.started') {
    return NextResponse.json({ ignored: true })
  }

  const fromNumber = (body.from_number as string | undefined) ?? ''
  if (!fromNumber) {
    return NextResponse.json({ error: 'Missing from_number' }, { status: 400 })
  }

  // ── Normalize + query ───────────────────────────────────────────────────────
  const digits = normalizeDigits(fromNumber)

  const service = createServiceClient()

  type CustomerRow = {
    id: string
    first_name: string
    last_name: string
    organization_id: string
    organizations: { slug: string } | null
  }

  const { data: matches } = await service
    .from('customers')
    .select('id, first_name, last_name, organization_id, organizations(slug)')
    .ilike('phone', `%${digits}%`)
    .limit(1) as { data: CustomerRow[] | null; error: unknown }

  const match = matches?.[0] ?? null

  // ── Build and store call event ───────────────────────────────────────────────
  const callEvent: CallEvent = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    from_number: fromNumber,
    matched: !!match,
    ...(match && {
      customer_id: match.id,
      customer_name: `${match.first_name} ${match.last_name}`.trim(),
      customer_url: match.organizations?.slug
        ? `/dashboard/${match.organizations.slug}/customers/${match.id}`
        : `/customers/${match.id}`,
    }),
  }

  pushEvent(callEvent)

  // ── Response ────────────────────────────────────────────────────────────────
  if (match) {
    return NextResponse.json({
      matched: true,
      customer_id: match.id,
      customer_name: callEvent.customer_name,
      url: callEvent.customer_url,
    })
  }
  return NextResponse.json({ matched: false })
}

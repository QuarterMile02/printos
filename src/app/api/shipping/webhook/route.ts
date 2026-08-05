import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { SYSTEM_FROM_EMAIL } from '@/lib/email-sender'

// EasyPost tracker status → our shipment status
const STATUS_MAP: Record<string, string> = {
  pre_transit:          'pending',
  in_transit:           'shipped',
  out_for_delivery:     'shipped',
  delivered:            'delivered',
  available_for_pickup: 'delivered',
  return_to_sender:     'returned',
  failure:              'returned',
}

// Statuses that trigger customer notifications
const NOTIFY_STATUSES = new Set(['out_for_delivery', 'delivered'])

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return `+${digits}`
}

async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER
  if (!sid || !token || !from) return
  const e164 = toE164(to)
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      },
      body: new URLSearchParams({ To: e164, From: from, Body: body }).toString(),
    },
  )
}

async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    // Automated webhook notification, not a person -- system address.
    body: JSON.stringify({ from: SYSTEM_FROM_EMAIL, to, subject, html }),
  })
}

export async function POST(req: NextRequest) {
  // ── Signature verification ────────────────────────────────────────────────
  const secret = process.env.EASYPOST_WEBHOOK_SECRET
  if (!secret) {
    console.error('EASYPOST_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const sigHeader = req.headers.get('X-Hmac-Signature') ?? ''

  // EasyPost signs with: "hmac-sha256-hex=<hex_digest>"
  const PREFIX = 'hmac-sha256-hex='
  if (!sigHeader.startsWith(PREFIX)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const receivedHex = sigHeader.slice(PREFIX.length)
  const computedHex = createHmac('sha256', secret).update(rawBody).digest('hex')

  const receivedBuf = Buffer.from(receivedHex, 'hex')
  const computedBuf = Buffer.from(computedHex, 'hex')
  const sigValid =
    receivedBuf.length === computedBuf.length &&
    timingSafeEqual(receivedBuf, computedBuf)

  if (!sigValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // ─────────────────────────────────────────────────────────────────────────

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const description = body.description as string | undefined
  if (!description?.startsWith('tracker.')) {
    return NextResponse.json({ received: true })
  }

  const result = body.result as Record<string, unknown> | undefined
  if (!result) return NextResponse.json({ received: true })

  const trackingCode = result.tracking_code as string | undefined
  const epStatus    = result.status as string | undefined
  const publicUrl   = result.public_url as string | undefined
  if (!trackingCode || !epStatus) return NextResponse.json({ received: true })

  const newStatus = STATUS_MAP[epStatus]
  if (!newStatus) return NextResponse.json({ received: true })

  const service = createServiceClient()

  // Find shipment by tracking number and join to SO + customer
  type ShipRow = {
    id: string
    organization_id: string
    status: string
    sales_orders: {
      so_number: number
      title: string | null
      customers: {
        first_name: string
        last_name: string
        email: string | null
        phone: string | null
      } | null
    } | null
  }
  const { data: shipment } = await service
    .from('shipments')
    .select('id, organization_id, status, sales_orders(so_number, title, customers(first_name, last_name, email, phone))')
    .eq('tracking_number', trackingCode)
    .maybeSingle() as { data: ShipRow | null; error: unknown }

  if (!shipment) return NextResponse.json({ received: true })

  const { error: updateError } = await service.from('shipments').update({ status: newStatus }).eq('id', shipment.id)
  if (updateError) {
    console.error('[shipping/webhook] Failed to update shipment status:', updateError.message, { shipmentId: shipment.id, newStatus })
    // Non-2xx so EasyPost retries — an ACK here would tell EasyPost we
    // recorded the update when the write never actually happened.
    return NextResponse.json({ error: 'Failed to update shipment status' }, { status: 500 })
  }

  if (NOTIFY_STATUSES.has(epStatus)) {
    const so = shipment.sales_orders
    const customer = so?.customers
    if (!customer) return NextResponse.json({ received: true })

    const soLabel = `SO-${String(so.so_number).padStart(4, '0')}${so.title ? ` – ${so.title}` : ''}`
    const customerName = `${customer.first_name} ${customer.last_name}`
    const trackUrl = publicUrl ?? ''
    const isDelivered = epStatus === 'delivered'

    const smsText = isDelivered
      ? `Hi ${customer.first_name}! Your order ${soLabel} has been delivered. Thank you for your business!`
      : `Hi ${customer.first_name}! Your order ${soLabel} is out for delivery today. Track: ${trackUrl}`

    const emailSubject = isDelivered ? `Your order has been delivered` : `Your order is out for delivery`
    const emailHtml = isDelivered
      ? `<p>Hi ${customerName},</p><p>Great news — your order <strong>${soLabel}</strong> has been delivered.</p><p>Thank you for your business!</p>`
      : `<p>Hi ${customerName},</p><p>Your order <strong>${soLabel}</strong> is out for delivery today.</p>${trackUrl ? `<p><a href="${trackUrl}">Track your shipment</a></p>` : ''}`

    const promises: Promise<void>[] = []
    if (customer.phone) promises.push(sendSms(customer.phone, smsText))
    if (customer.email) promises.push(sendEmail(customer.email, emailSubject, emailHtml))
    await Promise.allSettled(promises)
  }

  return NextResponse.json({ received: true })
}

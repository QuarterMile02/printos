// Required env vars (add to Vercel):
//   GHL_WEBHOOK_SECRET  — if set, x-ghl-signature header is validated (HMAC-SHA256)
//   GHL_LOCATION_ID     — GHL location ID for this org (future use with GHL API client)
//   GHL_ORG_SLUG        — PrintOS org slug to attach records to (default: quarter-mile-inc)

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const candidate = header?.startsWith('sha256=') ? header.slice(7) : (header ?? '')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate.padEnd(expected.length, ' ')))
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // ── Signature verification ─────────────────────────────────────────────────
  const secret = process.env.GHL_WEBHOOK_SECRET
  if (secret) {
    const sig = req.headers.get('x-ghl-signature')
    if (!sig || !verifySignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let payload: Record<string, any>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ── Stage filter — only handle "Quoting" stage events ─────────────────────
  const stageName: string =
    payload?.pipeline_stage?.name ??
    payload?.stage?.name ??
    payload?.stageName ??
    payload?.pipelineStage ??
    ''
  if (!stageName.toLowerCase().includes('quot')) {
    return NextResponse.json({ success: false, skipped: true, reason: 'Not a quoting stage event' })
  }

  // ── Extract contact fields ─────────────────────────────────────────────────
  const contact = payload?.contact ?? payload
  const firstName   = ((contact?.firstName   ?? contact?.first_name   ?? '') as string).trim()
  const lastName    = ((contact?.lastName    ?? contact?.last_name    ?? '') as string).trim()
  const email       = ((contact?.email       ?? '') as string).trim().toLowerCase()
  const phone       = ((contact?.phone       ?? contact?.phone_number ?? '') as string).trim()
  const companyName = ((contact?.company     ?? contact?.companyName  ?? contact?.company_name ?? '') as string).trim()

  if (!firstName && !lastName && !email && !phone) {
    return NextResponse.json({ error: 'Missing required contact fields' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const orgSlug = process.env.GHL_ORG_SLUG ?? 'quarter-mile-inc'

  // ── Resolve org ────────────────────────────────────────────────────────────
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .limit(1)
    .maybeSingle()
  if (!org) {
    console.error('[ghl-webhook] Organization not found for slug:', orgSlug)
    return NextResponse.json({ error: 'Organization not found' }, { status: 500 })
  }
  const orgId = (org as { id: string }).id

  // ── Look up existing customer by email or phone ────────────────────────────
  let customerId: string | null = null
  if (email || phone) {
    const orParts = [
      email ? `email.eq.${email}` : null,
      phone ? `phone.eq.${phone}` : null,
    ].filter(Boolean).join(',')
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('organization_id', orgId)
      .or(orParts)
      .limit(1)
      .maybeSingle()
    if (existing) customerId = (existing as { id: string }).id
  }

  // ── Create customer if not found ───────────────────────────────────────────
  if (!customerId) {
    const { data: newCustomer, error: custErr } = await supabase
      .from('customers')
      .insert({
        organization_id: orgId,
        first_name: firstName || 'Unknown',
        last_name: lastName || '',
        email: email || null,
        phone: phone || null,
        company_name: companyName || null,
        status: 'Active',
        lead_source: 'GHL',
        is_active: true,
      })
      .select('id')
      .single()
    if (custErr || !newCustomer) {
      console.error('[ghl-webhook] Failed to create customer:', custErr)
      return NextResponse.json({ error: custErr?.message ?? 'Failed to create customer' }, { status: 500 })
    }
    customerId = (newCustomer as { id: string }).id
  }

  // ── Find first owner/admin to assign the quote to ─────────────────────────
  const { data: members } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .in('role', ['owner', 'admin'])
    .limit(1)
  const assignedTo: string | null = (members as any[])?.[0]?.user_id ?? null

  // ── Create draft quote ─────────────────────────────────────────────────────
  const quoteInsert: Record<string, any> = {
    organization_id: orgId,
    customer_id: customerId,
    title: `GHL Lead — ${[firstName, lastName].filter(Boolean).join(' ')}`,
    status: 'draft',
    needs_pricing_approval: false,
    needs_rescue: false,
  }
  if (assignedTo) quoteInsert.sales_rep_id = assignedTo

  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .insert(quoteInsert)
    .select('id')
    .single()
  if (quoteErr || !quote) {
    console.error('[ghl-webhook] Failed to create quote:', quoteErr)
    return NextResponse.json({ error: quoteErr?.message ?? 'Failed to create quote' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    customerId,
    quoteId: (quote as { id: string }).id,
  })
}

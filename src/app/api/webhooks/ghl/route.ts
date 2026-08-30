// Required env vars (add to Vercel):
//   GHL_WEBHOOK_SECRET  — PHASE 3: ENFORCED. Compared (constant-time) against
//                         the x-ghl-shared-secret header GHL sends. A missing
//                         or mismatched header is rejected (401); an unset
//                         secret fails closed (500) rather than falling back
//                         to permissive Phase 1 behavior. Phase 2 (observe
//                         only, header confirmed matching in production —
//                         Vercel logs, 2026-08-27 12:17:36: secretConfigured=
//                         true headerPresent=true headerMatches=true) is what
//                         cleared this for enforcement. See
//                         known-issues/2026-08-25-ghl-webhook-shared-secret-and-test-customer-investigation.md
//                         for the full 3-phase rollout.
//   GHL_LOCATION_ID     — GHL location ID for this org (future use with GHL API client)
//   GHL_ORG_SLUG        — PrintOS org slug to attach records to (default: quarter-mile-inc)

import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'

// Constant-time compare -- never `===`, which short-circuits on the first
// mismatched byte and leaks the secret's length/prefix via timing. Hashes
// both values with SHA-256 first, then timingSafeEqual's the two 32-byte
// digests -- always equal-length by construction, so timingSafeEqual
// itself never sees a length mismatch (no `&&` short-circuit hiding it,
// no zero-padding that would make "abc" and "abc\0" collide) and can
// never throw.
function constantTimeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest()
  const digestB = createHash('sha256').update(b).digest()
  return timingSafeEqual(digestA, digestB)
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // ── PHASE 3 — shared-secret auth: ENFORCED, fail closed ─────────────────────
  // Phase 2 confirmed live in production (Vercel, 2026-08-27 12:17:36):
  // secretConfigured=true headerPresent=true headerMatches=true. That's what
  // clears this for enforcement -- reversing Phase 1's permissive "observe
  // only, never reject" stance on purpose.
  //
  // Fail CLOSED on a missing secret, same reasoning as
  // payment_gateway_settings: an unconfigured secret is never "allow", it's a
  // 500. A missing or wrong header is a 401. Neither response tells the
  // caller which specific thing was wrong -- both "no header" and "header
  // present but mismatched" collapse into the same generic 401 below via
  // headerMatches, and the 500/401 bodies never echo the header or secret.
  //
  // Logs ONLY booleans. Never the secret, the header value, or any part of
  // either, at any log level, in any branch.
  const expectedSecret = process.env.GHL_WEBHOOK_SECRET
  const presentedHeader = req.headers.get('x-ghl-shared-secret')
  const secretConfigured = !!expectedSecret
  const headerPresent = !!presentedHeader
  const headerMatches = secretConfigured && headerPresent
    ? constantTimeEqual(presentedHeader!, expectedSecret!)
    : false
  // Grep target for "is GHL posting at all, and does Esteban's header
  // match?" -- one line per inbound request, fires unconditionally, before
  // any rejection below, so a rejected request is just as visible here as
  // an accepted one.
  console.log(`[ghl-webhook] request received -- secretConfigured=${secretConfigured} headerPresent=${headerPresent} headerMatches=${headerMatches}`)

  if (!secretConfigured) {
    // Distinct from the 401 below on purpose: this is OUR misconfiguration,
    // not the caller's bad credential -- a 500 says so, a 401 would not.
    console.log('[ghl-webhook] refusing request: GHL_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 500 })
  }
  if (!headerMatches) {
    // Covers both "no header" and "header present but wrong" -- headerMatches
    // is already false for either case, so this one check and one generic
    // response can never leak which of the two actually happened.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let payload: Record<string, any>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.log('[ghl-webhook] payload shape:', JSON.stringify({ byteLength: rawBody.length, parseError: true }))
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Shape-only log — replaces the old unredacted full-raw-body log (this
  // route used to log every incoming customer's name/email/phone in the
  // clear, on every request, forever). Structure only: key names,
  // presence booleans, byte length. Never a value.
  console.log('[ghl-webhook] payload shape:', JSON.stringify({
    byteLength: rawBody.length,
    topLevelKeys: Object.keys(payload ?? {}),
    hasContact: !!payload?.contact,
    contactKeys: payload?.contact ? Object.keys(payload.contact) : [],
    hasCustomData: !!payload?.customData,
    customDataKeys: payload?.customData ? Object.keys(payload.customData) : [],
  }))

  // Returns the first non-empty string among candidates. Used instead of
  // trusting a single object (e.g. payload.contact) for every field --
  // confirmed via a real captured payload (Pipeline Stage Changed trigger)
  // that payload.contact is NOT always contact data: for that trigger type
  // it holds GHL's attribution/UTM tracking object instead (no name/email/
  // phone fields at all), while the real values sit at the top level of
  // payload and are duplicated in payload.customData. Checking all three
  // per-field, in priority order, works for that shape and remains
  // backward compatible with a Contact-based trigger where payload.contact
  // genuinely does hold the contact fields.
  function firstNonEmpty(...values: unknown[]): string {
    for (const v of values) {
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }

  // ── Stage detection ────────────────────────────────────────────────────────
  // GHL sends this trigger type's stage under "pipleline_stage" (their own
  // typo -- transposed letters, confirmed against a real captured payload),
  // as a plain string, not nested under .name like the other candidates.
  const stageName = firstNonEmpty(
    payload?.pipeline_stage?.name,
    payload?.pipeline_stage,
    payload?.pipleline_stage,
    payload?.stage?.name,
    payload?.stageName,
    payload?.pipelineStage,
  )
  const isQuotingStage = stageName.toLowerCase().includes('quot')

  // ── Extract contact fields ─────────────────────────────────────────────────
  const contactObj = payload?.contact ?? {}
  const customData = payload?.customData ?? {}

  const firstName = firstNonEmpty(contactObj.firstName, contactObj.first_name, payload.firstName, payload.first_name, customData.firstName, customData.first_name)
  const lastName  = firstNonEmpty(contactObj.lastName, contactObj.last_name, payload.lastName, payload.last_name, customData.lastName, customData.last_name)
  const email     = firstNonEmpty(contactObj.email, payload.email, customData.email).toLowerCase()
  const phone     = firstNonEmpty(contactObj.phone, contactObj.phone_number, payload.phone, payload.phone_number, customData.phone, customData.phone_number)
  const companyName = firstNonEmpty(contactObj.company, contactObj.companyName, contactObj.company_name, payload.company, payload.companyName, payload.company_name, customData.company, customData.companyName, customData.company_name)

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
    const { data: existing, error: lookupErr } = await supabase
      .from('customers')
      .select('id')
      .eq('organization_id', orgId)
      .or(orParts)
      .limit(1)
      .maybeSingle()
    if (lookupErr) {
      // Don't fall through to "create customer" on a failed dedup lookup —
      // that would silently create a duplicate for an existing contact.
      console.error('[ghl-webhook] Dedup lookup failed:', lookupErr.message)
      return NextResponse.json({ error: 'Failed to look up existing customer' }, { status: 500 })
    }
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
        status: 'lead',
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

  // ── Non-quoting stage: customer synced, no quote needed ───────────────────
  if (!isQuotingStage) {
    return NextResponse.json({ success: true, action: 'customer_synced', customerId, stage: stageName })
  }

  // ── Find first owner/admin to assign the quote to ─────────────────────────
  const { data: members } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .in('role', ['owner', 'admin'])
    .limit(1)
  let assignedTo: string | null = (members as any[])?.[0]?.user_id ?? null

  if (!assignedTo) {
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle()
    assignedTo = (ownerProfile as { id: string } | null)?.id ?? null
  }

  // ── Create draft quote ─────────────────────────────────────────────────────
  const quoteInsert: Record<string, any> = {
    organization_id: orgId,
    customer_id: customerId,
    title: `GHL Lead — ${[firstName, lastName].filter(Boolean).join(' ')}`,
    status: 'draft',
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

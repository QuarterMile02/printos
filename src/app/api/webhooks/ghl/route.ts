// Required env vars (add to Vercel):
//   GHL_WEBHOOK_SECRET  — PHASE 1: observed and logged only, NOT enforced yet.
//                         Compared (constant-time) against the
//                         x-ghl-shared-secret header GHL sends. Every request
//                         is still accepted regardless of the result -- see
//                         known-issues/2026-08-25-ghl-webhook-shared-secret-and-test-customer-investigation.md
//                         for the full 3-phase rollout this is phase 1 of.
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

  // ── PHASE 1 — shared-secret auth: observe only, never reject ────────────────
  // GHL_WEBHOOK_SECRET is unset in production right now and Esteban hasn't
  // configured the x-ghl-shared-secret header yet -- rejecting here would
  // break the live GHL -> PrintOS lead sync the moment this deploys.
  // Deliberately does NOT inherit PR #21's "500 if secret unset" behavior;
  // that's phase 3, once these logs confirm the header is actually matching.
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
  // any parsing or the (still nonexistent) rejection.
  console.log(`[ghl-webhook] request received -- secretConfigured=${secretConfigured} headerPresent=${headerPresent} headerMatches=${headerMatches}`)

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

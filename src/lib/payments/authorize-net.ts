// Server-side Authorize.net charge — the ONLY place transaction_key is
// decrypted and used. Takes the opaque payment nonce Accept.js already
// produced client-side (see record-payment-form.tsx) and creates an
// authCaptureTransaction. Never sees, never accepts, a raw card number or
// CVV — that's the whole point of Accept.js: the browser talks to
// Authorize.net directly and hands this function only an opaque token.
//
// No SDK dependency -- plain fetch against Authorize.net's JSON API,
// matching how every other third-party integration in this codebase is
// written (EasyPost, Twilio, Resend, fal.ai all use raw fetch, no vendor
// SDKs).

import { createServiceClient } from '@/lib/supabase/server'
import { decryptCredentialTolerant } from '@/lib/credential-crypto'

export type OpaqueData = { dataDescriptor: string; dataValue: string }

export type ChargeCardInput = {
  orgId: string
  amountCents: number
  opaqueData: OpaqueData
  invoiceNumber?: string
  description?: string
  customerId?: string
}

export type ChargeCardResult =
  | { error: string }
  | { transactionId: string; cardLast4: string; cardBrand: string }

type AuthNetErrorMsg = { code?: string; text?: string }
type AuthNetTransResponse = {
  responseCode?: string
  transId?: string
  accountNumber?: string
  accountType?: string
  errors?: { errorCode?: string; errorText?: string }[]
  messages?: { code?: string; description?: string }[]
}
type AuthNetResponse = {
  transactionResponse?: AuthNetTransResponse
  messages?: { resultCode?: string; message?: AuthNetErrorMsg[] }
}

function apiHost(testMode: boolean): string {
  return testMode ? 'https://apitest.authorize.net/xml/v1/request.api' : 'https://api.authorize.net/xml/v1/request.api'
}

// Never falls back to an env var -- payment_gateway_settings (per-org,
// encrypted) is the ONLY source of Authorize.net credentials. Unlike
// EasyPost (fine to fall back to a shared account for orgs that haven't
// connected shipping), a payment-gateway fallback would mean a
// misconfigured org's card charges land on whatever account an env var
// pointed at -- fails loudly instead.
export async function chargeCard(input: ChargeCardInput): Promise<ChargeCardResult> {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    return { error: 'Invalid charge amount.' }
  }

  const service = createServiceClient()
  const { data } = await service
    .from('payment_gateway_settings')
    .select('gateway_type, api_login_id, transaction_key, use_test_mode, is_connected')
    .eq('organization_id', input.orgId)
    .maybeSingle()

  const row = data as {
    gateway_type: string | null
    api_login_id: string | null
    transaction_key: string | null
    use_test_mode: boolean | null
    is_connected: boolean | null
  } | null

  if (!row || !row.is_connected || row.gateway_type !== 'authorize_net' || !row.api_login_id || !row.transaction_key) {
    return { error: 'Payment gateway not configured for this organization.' }
  }

  const apiLoginId = decryptCredentialTolerant(row.api_login_id)
  const transactionKey = decryptCredentialTolerant(row.transaction_key)
  const testMode = row.use_test_mode ?? false

  const body = {
    createTransactionRequest: {
      merchantAuthentication: { name: apiLoginId, transactionKey },
      transactionRequest: {
        transactionType: 'authCaptureTransaction',
        amount: (input.amountCents / 100).toFixed(2),
        payment: { opaqueData: input.opaqueData },
        ...(input.invoiceNumber || input.description
          ? { order: { invoiceNumber: input.invoiceNumber?.slice(0, 20), description: input.description?.slice(0, 255) } }
          : {}),
        ...(input.customerId ? { customer: { id: input.customerId.slice(0, 20) } } : {}),
      },
    },
  }

  let res: Response
  try {
    res = await fetch(apiHost(testMode), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    console.error('[authorize-net] fetch failed:', e instanceof Error ? e.message : e)
    return { error: 'Could not reach the payment gateway. Please try again.' }
  }

  // Authorize.net's JSON API prefixes responses with a UTF-8 BOM -- strip
  // it before parsing or JSON.parse throws on well-formed responses.
  const rawText = (await res.text()).replace(/^﻿/, '')
  let parsed: AuthNetResponse
  try {
    parsed = JSON.parse(rawText) as AuthNetResponse
  } catch {
    console.error('[authorize-net] non-JSON response:', rawText.slice(0, 500))
    return { error: 'Payment gateway returned an unreadable response.' }
  }

  const txn = parsed.transactionResponse
  const topLevelError = parsed.messages?.resultCode === 'Error'
  if (topLevelError && !txn) {
    const msg = parsed.messages?.message?.[0]?.text ?? 'Payment gateway rejected the request.'
    console.error('[authorize-net] request-level error:', msg)
    return { error: msg }
  }
  if (!txn) {
    console.error('[authorize-net] no transactionResponse in body:', rawText.slice(0, 500))
    return { error: 'Payment gateway returned an unexpected response.' }
  }

  // responseCode: 1 = approved, 2 = declined, 3 = error, 4 = held for review.
  if (txn.responseCode !== '1') {
    const detail = txn.errors?.map((e) => e.errorText).filter(Boolean).join(' ')
      ?? txn.messages?.map((m) => m.description).filter(Boolean).join(' ')
    const reason = txn.responseCode === '2' ? 'Card declined.' : 'Payment could not be processed.'
    return { error: detail ? `${reason} ${detail}` : reason }
  }

  const digitsOnly = (txn.accountNumber ?? '').replace(/\D/g, '')
  return {
    transactionId: txn.transId ?? '',
    cardLast4: digitsOnly.slice(-4),
    cardBrand: txn.accountType ?? '',
  }
}

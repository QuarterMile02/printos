// Browser-only helper for Authorize.net's Accept.js — client-side card
// tokenization. The card number/CVV typed into the form are handed
// directly to Accept.js's dispatchData(), which sends them straight to
// Authorize.net over HTTPS and hands back an opaque payment nonce
// (dataDescriptor/dataValue). Nothing in this file, or anything that
// calls it, ever sends a card number or CVV to a PrintOS server — the
// nonce is the only thing that crosses the network to us.
'use client'

export type AcceptJsMessage = { code: string; text: string }
export type AcceptJsOpaqueData = { dataDescriptor: string; dataValue: string }
export type AcceptJsResponse = {
  messages: { resultCode: 'Ok' | 'Error'; message: AcceptJsMessage[] }
  opaqueData?: AcceptJsOpaqueData
}
type AcceptJsSecureData = {
  authData: { clientKey: string; apiLoginID: string }
  cardData: { cardNumber: string; month: string; year: string; cardCode: string }
}
interface AcceptJsGlobal {
  dispatchData(secureData: AcceptJsSecureData, callback: (response: AcceptJsResponse) => void): void
}
declare global {
  interface Window { Accept?: AcceptJsGlobal }
}

const TEST_SRC = 'https://jstest.authorize.net/v1/Accept.js'
const LIVE_SRC = 'https://js.authorize.net/v1/Accept.js'

let loadPromise: Promise<void> | null = null
let loadedSrc: string | null = null

// Injects the Accept.js <script> tag once per src. If test mode flips
// between calls (shouldn't happen mid-session, but don't trust it) a
// fresh script tag for the new src is injected rather than silently
// reusing the wrong environment's tokenizer.
function loadAcceptJs(testMode: boolean): Promise<void> {
  const src = testMode ? TEST_SRC : LIVE_SRC
  if (loadPromise && loadedSrc === src) return loadPromise

  loadedSrc = src
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load the payment gateway script.'))
    document.head.appendChild(script)
  })
  return loadPromise
}

export async function tokenizeCard(
  testMode: boolean,
  apiLoginId: string,
  clientKey: string,
  card: { cardNumber: string; month: string; year: string; cardCode: string },
): Promise<{ error: string } | { opaqueData: AcceptJsOpaqueData }> {
  try {
    await loadAcceptJs(testMode)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load the payment gateway script.' }
  }
  if (!window.Accept) return { error: 'Payment gateway script did not load correctly.' }

  return new Promise((resolve) => {
    window.Accept!.dispatchData(
      {
        authData: { clientKey, apiLoginID: apiLoginId },
        cardData: card,
      },
      (response) => {
        if (response.messages.resultCode !== 'Ok' || !response.opaqueData) {
          const detail = response.messages.message.map((m) => m.text).join(' ')
          resolve({ error: detail || 'Card could not be processed.' })
          return
        }
        resolve({ opaqueData: response.opaqueData })
      },
    )
  })
}

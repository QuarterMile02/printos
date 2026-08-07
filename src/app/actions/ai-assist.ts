'use server'

// Shared AI helpers built on the same mechanism as improveEmailBody
// (src/app/actions/improve-email.ts): a plain Anthropic Messages API call,
// same model, same auth, same fail-safe-to-original-input contract. Kept
// as a separate file (rather than editing improve-email.ts) so the
// existing "Improve with AI" feature is untouched by this work.

async function callClaude(prompt: string, maxTokens = 300): Promise<{ text: string; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { text: '', error: 'ANTHROPIC_API_KEY not configured. Add it to .env.local and Vercel env vars.' }
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error('[callClaude] API error:', res.status, errBody)
      return { text: '', error: `API error: ${res.status}` }
    }

    const data = await res.json()
    const text = data.content?.[0]?.text?.trim() ?? ''
    return { text }
  } catch (err) {
    console.error('[callClaude] Error:', err)
    return { text: '', error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ── Quote title suggestion (Item 3) ─────────────────────────────────────
// Generates a short, customer-facing title from a quote's line items.
// Never called automatically at write time — the sales rep always
// Accepts/Edits/Declines before it touches the actual quote.title.
export async function suggestQuoteTitle(
  lineItemsSummary: string,
): Promise<{ suggested: string; error?: string }> {
  if (!lineItemsSummary.trim()) return { suggested: '', error: 'No line items to summarize.' }

  const prompt = `You are helping a sign and print shop (Quarter Mile, Inc.) write a short, customer-facing quote title based on its line items. Return ONLY the title text — no quotes, no commentary, no trailing punctuation. Keep it under 60 characters, specific enough to identify the job (e.g. "3 Vehicle Wraps – Ford Transit Fleet" or "Storefront Window Vinyl & A-Frame Sign"), not generic ("Print Order").\n\nLine items:\n${lineItemsSummary}`

  const { text, error } = await callClaude(prompt, 60)
  if (error) return { suggested: '', error }
  // Strip stray wrapping quotes the model sometimes adds despite instructions.
  const suggested = text.replace(/^["'“](.*)["'”]$/, '$1').trim()
  return { suggested }
}

// ── Per-order email personalization (Item 2, "AI-personalize per order") ─
// Takes an already variable-substituted email body plus short order/
// customer context and tailors it. Falls back to the original body
// unchanged on any failure, same fail-safe contract as improveEmailBody.
export async function personalizeEmailForOrder(
  renderedBody: string,
  orderContext: string,
): Promise<{ personalized: string; error?: string }> {
  if (!renderedBody.trim()) return { personalized: renderedBody }

  const prompt = `You are a copywriter for Quarter Mile, Inc., a sign and print shop in Laredo, TX. Personalize this email for the specific order below — reference what's actually being made where it reads naturally, keep the QMI brand voice (friendly, local, 110% customer satisfaction focus), and do NOT change any dollar amounts, dates, links, or contact info. Keep the same overall length and structure. Return ONLY the personalized email body text, no commentary.\n\nOrder details:\n${orderContext}\n\nEmail to personalize:\n${renderedBody}`

  const { text, error } = await callClaude(prompt, 1024)
  if (error || !text) return { personalized: renderedBody, error }
  return { personalized: text }
}

'use server'

export async function improveEmailBody(currentBody: string): Promise<{ improved: string; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { improved: currentBody, error: 'ANTHROPIC_API_KEY not configured. Add it to .env.local and Vercel env vars.' }
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
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `You are a copywriter for Quarter Mile, Inc., a sign and print shop in Laredo, TX. Rewrite this email template to be warmer, more professional, and match the QMI brand voice: friendly, local Laredo business, 110% customer satisfaction focus. Keep all {{variable}} placeholders exactly as they are. Keep the same general message and structure but improve the tone and wording. Return ONLY the improved email body text, no commentary.\n\nCurrent email:\n${currentBody}`,
        }],
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error('[improveEmailBody] API error:', res.status, errBody)
      return { improved: currentBody, error: `API error: ${res.status}` }
    }

    const data = await res.json()
    const improved = data.content?.[0]?.text ?? currentBody

    return { improved }
  } catch (err) {
    console.error('[improveEmailBody] Error:', err)
    return { improved: currentBody, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

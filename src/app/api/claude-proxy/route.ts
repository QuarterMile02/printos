import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Body = {
  vehicleB64?: string        // base64 only (no data: prefix) or full data URL
  logoB64?: string
  vehicle?: string           // e.g. "2022 Ford F-150 Lariat"
  bizName?: string
  bizType?: string           // e.g. "Plumbing", "Landscaping"
  colors?: string | string[] // free-text description OR array of hex strings
  style?: string             // free-text style notes
  phone?: string
  website?: string
  conceptBriefs?: string[]   // ordered list of constraints for each concept
}

type WrapConcept = {
  concept_name: string
  tagline: string
  colors: string[]
  layout: string
  material: string
  complexity: 'Simple' | 'Medium' | 'Bold'
  fal_prompt: string
}

// Strip `data:image/...;base64,` prefix if present.
function stripDataPrefix(s: string): { media_type: string; data: string } {
  const m = s.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/)
  if (m) return { media_type: m[1], data: m[2] }
  return { media_type: 'image/jpeg', data: s }
}

// Extract the first JSON object from a string (handles markdown fences + prose).
function extractJson(text: string): unknown | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fence ? fence[1] : text).trim()
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) return null
  try {
    return JSON.parse(raw.slice(firstBrace, lastBrace + 1))
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const body = (await req.json()) as Body
    const { vehicleB64, logoB64, vehicle, bizName, bizType, colors, style, phone, website, conceptBriefs } = body

    // Normalize colors: accept either an array of hex strings OR a raw
    // free-text description (e.g. "Green #93ca3b and Fuchsia #ee2b7b").
    const colorsDisplay = Array.isArray(colors)
      ? colors.filter((c) => typeof c === 'string' && c.trim()).slice(0, 6).join(', ')
      : (typeof colors === 'string' ? colors.trim() : '')

    // Build the user message: vehicle image (required), logo image (optional), text brief.
    const userContent: Array<
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      | { type: 'text'; text: string }
    > = []

    if (vehicleB64) {
      const v = stripDataPrefix(vehicleB64)
      userContent.push({ type: 'image', source: { type: 'base64', media_type: v.media_type, data: v.data } })
    }
    if (logoB64) {
      const l = stripDataPrefix(logoB64)
      userContent.push({ type: 'image', source: { type: 'base64', media_type: l.media_type, data: l.data } })
    }

    const briefs = (conceptBriefs ?? []).filter((s) => typeof s === 'string' && s.trim())

    const promptLines = [
      'Generate THREE vehicle-wrap design concepts for the project below.',
      'The order of concepts is FIXED — produce them in exactly the order listed',
      'under CONCEPT ORDER. Each concept must satisfy its constraint.',
      '',
      'PROJECT BRIEF',
      vehicle ? `- Vehicle: ${vehicle}` : null,
      bizName ? `- Business: ${bizName}` : null,
      bizType ? `- Industry: ${bizType}` : null,
      phone ? `- Phone: ${phone}` : null,
      website ? `- Website: ${website}` : null,
      colorsDisplay ? `- Brand colors: ${colorsDisplay}` : null,
      style ? `- Style notes: ${style}` : null,
      '',
      briefs.length ? 'CONCEPT ORDER (produce in this exact order)' : null,
      ...briefs.map((b, i) => `- #${i + 1}: ${b}`),
      briefs.length ? '' : null,
      'REQUIREMENTS',
      '- The three concepts array must be ordered to match CONCEPT ORDER above.',
      '- Each fal_prompt is sent to FLUX Kontext (image editing), NOT a text-to-image',
      '  model. Phrase each fal_prompt as a list of EDITS to apply to the provided',
      '  vehicle photo — not as a description of a new scene. Preserve the car shape,',
      '  angle, perspective, and background exactly.',
      '- Kontext prompt structure — each fal_prompt should:',
      '    • Start with a directive like "Apply a vinyl wrap to this vehicle." or',
      '      "Apply a partial vinyl wrap to this vehicle (doors and rear only)."',
      '    • Explicitly state "Keep the exact car shape, angle, perspective, and',
      '      background." so Kontext preserves the source photo.',
      '    • Describe body color changes per panel (e.g. "Change the doors to matte',
      '      black"). For partial wraps, name the panels that stay factory paint.',
      '    • Describe graphics by placement + style + color (e.g. "Add a diagonal',
      '      lime-green geometric stripe across the rear quarter panel").',
      '    • Describe logo placement + size + color (e.g. "Place the business logo',
      '      in white on the rear doors, roughly 18 inches wide").',
      '    • Describe contact-info placement (phone, website) if any, with panel +',
      '      text color.',
      '    • End with a short photorealism hint: "Clean, crisp vinyl finish, no',
      '      wrinkles, commercial-quality wrap application."',
      '- Example fal_prompt shape:',
      '  "Apply a full vinyl wrap to this vehicle. Keep the exact car shape, angle,',
      '  perspective, and background. Change the body to deep navy #1a2b4c. Add a',
      '  lime-green (#93ca3b) diagonal stripe running from the front fender to the',
      '  rear quarter panel. Place the business logo in white on both rear doors.',
      '  Add the phone number in white along the bottom of the driver-side rear',
      '  door. Clean, crisp vinyl finish, no wrinkles, commercial-quality wrap."',
      '- Keep material recommendations realistic (e.g., 3M IJ180Cv3, Avery MPI 1105,',
      '  Oracal 3951RA).',
      '',
      'OUTPUT FORMAT — return ONLY a single JSON object with this exact shape:',
      '{',
      '  "concepts": [',
      '    {',
      '      "concept_name": "short memorable name",',
      '      "tagline": "one-line positioning phrase",',
      '      "colors": ["#RRGGBB", "#RRGGBB", "#RRGGBB"],',
      '      "layout": "2–3 sentence description of the wrap composition",',
      '      "material": "recommended vinyl + finish",',
      '      "complexity": "Simple" | "Medium" | "Bold",',
      '      "fal_prompt": "detailed image generation prompt (80–200 words)"',
      '    }',
      '  ]',
      '}',
    ].filter((s): s is string => s != null)

    userContent.push({ type: 'text', text: promptLines.join('\n') })

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        system:
          'You are a senior vehicle-wrap designer. Produce on-brand, production-realistic concepts. ' +
          'Respond ONLY with the JSON object requested. No prose, no markdown fences.',
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      return NextResponse.json(
        { error: `Anthropic ${anthropicRes.status}: ${errText.slice(0, 500)}` },
        { status: 502 },
      )
    }

    const data = (await anthropicRes.json()) as {
      content?: Array<{ type: string; text?: string }>
    }
    const textBlock = (data.content ?? []).find((b) => b.type === 'text')?.text ?? ''
    const parsed = extractJson(textBlock) as { concepts?: WrapConcept[] } | null
    if (!parsed || !Array.isArray(parsed.concepts)) {
      return NextResponse.json(
        { error: 'Model did not return valid concepts JSON', raw: textBlock.slice(0, 1000) },
        { status: 502 },
      )
    }

    return NextResponse.json({ concepts: parsed.concepts.slice(0, 3) })
  } catch (err) {
    console.error('[/api/claude-proxy] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}

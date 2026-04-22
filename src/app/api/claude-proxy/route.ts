import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Body = {
  vehicleB64?: string        // base64 only (no data: prefix) or full data URL
  logoB64?: string
  vehicle?: string           // e.g. "2022 Ford F-150 Lariat"
  bizName?: string
  bizType?: string           // e.g. "Plumbing", "Landscaping"
  colors?: string[]          // brand colors as hex strings
  style?: string             // free-text style notes
  phone?: string
  website?: string
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
    const { vehicleB64, logoB64, vehicle, bizName, bizType, colors, style, phone, website } = body

    const colorList = (colors ?? []).filter((c) => typeof c === 'string' && c.trim()).slice(0, 6)

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

    const promptLines = [
      'Generate THREE distinct vehicle-wrap design concepts for the project below.',
      '',
      'PROJECT BRIEF',
      vehicle ? `- Vehicle: ${vehicle}` : null,
      bizName ? `- Business: ${bizName}` : null,
      bizType ? `- Industry: ${bizType}` : null,
      phone ? `- Phone: ${phone}` : null,
      website ? `- Website: ${website}` : null,
      colorList.length ? `- Brand colors: ${colorList.join(', ')}` : null,
      style ? `- Style notes: ${style}` : null,
      '',
      'REQUIREMENTS',
      '- Produce three clearly different concepts (varying color emphasis, layout, mood).',
      '- For each concept, write a detailed image-generation prompt that describes the',
      '  vehicle wrap exactly as it should look, including color placement, logo location,',
      '  contact info placement, and overall composition. The prompt will be sent to an',
      '  image-to-image model along with the vehicle photo, so phrase it as a description',
      '  of the final wrapped vehicle.',
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

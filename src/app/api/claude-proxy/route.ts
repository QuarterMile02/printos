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
  // Design preferences (Step 2 of the wizard)
  imageryStyle?: string[]    // selected categories (incl. "Other")
  imageryOther?: string
  artStyle?: string[]
  artOther?: string
  keyFocus?: string[]
  keyOther?: string
  inspiration?: string       // freeform — what they like / how it should feel
  avoid?: string             // freeform — colors / styles / elements to avoid
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

// Best-effort website fetch (5s budget). Returns ~3KB of stripped text or
// null on any error. Skip non-http(s) schemes so we don't try file:// etc.
async function fetchWebsiteContext(rawUrl: string): Promise<string | null> {
  try {
    let url = rawUrl.trim()
    if (!url) return null
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'PrintOS-WrapConcepts/1.0' },
      })
      if (!res.ok) return null
      const html = (await res.text()).slice(0, 50000)
      const title = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1]?.trim() ?? ''
      const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{0,500})["']/i)?.[1]?.trim() ?? ''
      const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']{0,500})["']/i)?.[1]?.trim() ?? ''
      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2500)
      const parts: string[] = []
      if (title) parts.push(`Title: ${title}`)
      if (metaDesc) parts.push(`Meta description: ${metaDesc}`)
      if (ogDesc && ogDesc !== metaDesc) parts.push(`OG description: ${ogDesc}`)
      if (stripped) parts.push(`Body excerpt: ${stripped}`)
      return parts.length > 0 ? parts.join('\n') : null
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
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
    const {
      vehicleB64, logoB64, vehicle, bizName, bizType, colors, style, phone, website, conceptBriefs,
      imageryStyle, imageryOther, artStyle, artOther, keyFocus, keyOther, inspiration, avoid,
    } = body

    // Best-effort site fetch — runs in parallel with prompt assembly via await.
    const websiteContext = website ? await fetchWebsiteContext(website) : null

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

    const formatList = (arr: string[] | undefined, other: string | undefined) => {
      const items = (arr ?? []).filter((s) => typeof s === 'string' && s.trim() && s !== 'Other')
      if (other && other.trim() && (arr ?? []).includes('Other')) items.push(`Other: ${other.trim()}`)
      return items
    }
    const imageryItems = formatList(imageryStyle, imageryOther)
    const artItems = formatList(artStyle, artOther)
    const focusItems = formatList(keyFocus, keyOther)

    const hasDesignPrefs =
      imageryItems.length > 0 || artItems.length > 0 || focusItems.length > 0 ||
      (inspiration && inspiration.trim()) || (avoid && avoid.trim())

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
      logoB64 ? 'LOGO CONTEXT' : null,
      logoB64
        ? '- The customer has uploaded their logo. Study it carefully — extract the dominant colors, any icons or symbols, font style, and overall brand personality. Every concept MUST incorporate these logo elements. Reference specific logo colors by hex code in your fal_prompt.'
        : null,
      logoB64 ? '' : null,
      hasDesignPrefs ? 'DESIGN PREFERENCES' : null,
      imageryItems.length ? `- Imagery style: ${imageryItems.join('; ')}` : null,
      artItems.length ? `- Art style: ${artItems.join('; ')}` : null,
      focusItems.length ? `- Key focus: ${focusItems.join('; ')}` : null,
      inspiration && inspiration.trim() ? `- Inspiration / desired feel: ${inspiration.trim()}` : null,
      avoid && avoid.trim() ? `- AVOID (do not include any of these): ${avoid.trim()}` : null,
      hasDesignPrefs ? '' : null,
      websiteContext ? 'WEBSITE CONTEXT (fetched from the customer site)' : null,
      websiteContext ?? null,
      websiteContext ? '' : null,
      briefs.length ? 'CONCEPT ORDER (produce in this exact order)' : null,
      ...briefs.map((b, i) => `- #${i + 1}: ${b}`),
      briefs.length ? '' : null,
      'REQUIREMENTS',
      '- The three concepts array must be ordered to match CONCEPT ORDER above.',
      '- Each fal_prompt is sent to FLUX Kontext (image editing), NOT a text-to-image',
      '  model. Phrase each fal_prompt as a list of EDITS to apply to the provided',
      '  vehicle photo. Honor every selected DESIGN PREFERENCE above.',
      '- Each fal_prompt MUST:',
      '    • Start with: "Keep this exact vehicle, same angle, same background, same lighting."',
      '    • Describe specific color changes panel by panel (hood, roof, doors, rear,',
      '      quarter panels, fenders, bumpers). For partial wraps, name the panels',
      '      that stay factory paint.',
      '    • Specify exact logo placement: which panel, what size, what color',
      '      treatment. Reference specific logo colors by hex.',
      '    • Reference the chosen ART STYLE and IMAGERY STYLE preferences (e.g.,',
      '      "bold geometric color blocks", "photorealistic equipment imagery").',
      '    • Describe contact-info placement (phone, website) if KEY FOCUS calls for it,',
      '      with the panel and text color.',
      '    • End with: "Photorealistic vinyl wrap, professional installation quality, sharp edges, no distortion."',
      '- Example fal_prompt shape:',
      '  "Keep this exact vehicle, same angle, same background, same lighting. Change',
      '  the doors and rear to deep navy #1a2b4c with a lime-green (#93ca3b) diagonal',
      '  stripe across the rear quarter panel. Place the business logo in white on',
      '  both rear doors, roughly 18 inches wide. Add the phone number in white along',
      '  the bottom of the driver-side rear door. Bold geometric style. Photorealistic',
      '  vinyl wrap, professional installation quality, sharp edges, no distortion."',
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
          "You are an expert vehicle wrap graphic designer and brand visibility specialist with 20+ years experience designing high-impact fleet wraps for commercial businesses. You understand color theory, vinyl materials, panel layouts, and how designs read at 65mph. You study the customer's logo, brand colors, industry, and business type deeply before designing. You create wraps that make vehicles into rolling billboards — instantly communicating what the business does, building brand recognition, and standing out from competitors. You always consider: contrast for readability, color psychology for the industry, logo placement for maximum visibility, and the specific panels of the vehicle. You reference the uploaded logo colors, shapes, and style in every concept. You never ignore the brand assets provided.\n\n" +
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

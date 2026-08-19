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

// Structured website fetch (5s budget). Pulls title, meta description,
// h1–h3 headings, image alt text, inline colors, and any sentence that
// contains wrap/fleet/brand/vehicle/sign/commercial/logo/color/design.
// Returns a ~3000-char summary or null on any error.
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
      const html = (await res.text()).slice(0, 80000)

      const titleMatch = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1]?.trim() ?? ''
      const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{0,500})["']/i)?.[1]?.trim() ?? ''
      const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']{0,500})["']/i)?.[1]?.trim() ?? ''
      const themeColor = html.match(/<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim() ?? ''

      const headings: string[] = []
      for (const tag of ['h1', 'h2', 'h3']) {
        const re = new RegExp(`<${tag}[^>]*>([\\s\\S]{0,250}?)</${tag}>`, 'gi')
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
          const t = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
          if (t && t.length > 1) headings.push(`${tag}: ${t}`)
          if (headings.length >= 40) break
        }
      }

      const alts: string[] = []
      const altRe = /<img[^>]+alt=["']([^"']{2,200})["']/gi
      let am: RegExpExecArray | null
      while ((am = altRe.exec(html)) !== null) {
        const a = am[1].replace(/\s+/g, ' ').trim()
        if (a) alts.push(a)
        if (alts.length >= 25) break
      }

      const colorSet = new Set<string>()
      for (const m of html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) colorSet.add(m[0])
      for (const m of html.matchAll(/rgb\([^)]{1,60}\)/gi)) colorSet.add(m[0])
      for (const m of html.matchAll(/rgba\([^)]{1,80}\)/gi)) colorSet.add(m[0])
      if (themeColor) colorSet.add(themeColor)
      const colors = Array.from(colorSet).slice(0, 30)

      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim()

      const keywordsRe = /\b(wrap|fleet|brand|vehicle|sign|commercial|logo|color|colour|design)\b/i
      const keywordLines = stripped
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20 && s.length < 280 && keywordsRe.test(s))
        .slice(0, 15)

      const parts: string[] = []
      if (titleMatch) parts.push(`Title: ${titleMatch}`)
      if (metaDesc) parts.push(`Meta description: ${metaDesc}`)
      if (ogDesc && ogDesc !== metaDesc) parts.push(`OG description: ${ogDesc}`)
      if (headings.length) parts.push(`Headings:\n  - ${headings.join('\n  - ')}`)
      if (alts.length) parts.push(`Image alts:\n  - ${alts.join('\n  - ')}`)
      if (colors.length) parts.push(`Color values found: ${colors.join(', ')}`)
      if (keywordLines.length) parts.push(`Key sentences (wrap/brand/vehicle/etc):\n  - ${keywordLines.join('\n  - ')}`)
      if (stripped) parts.push(`Body excerpt: ${stripped.slice(0, 1500)}`)

      const joined = parts.join('\n\n').slice(0, 3000)
      return joined.length > 0 ? joined : null
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    console.error('[claude-proxy] fetchWebsiteContext error:', e instanceof Error ? e.message : e)
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

type BrandAnalysis = {
  logoColors: string[]
  logoDescription: string
  logoIconDescription: string
  fontStyle: string
  brandPersonality: string
  websitePrimaryServices: string[]
  websiteColorTheme: string
  vehicleBaseColor: string
  vehicleType: string
}

// First-pass Claude call: analyze the logo, vehicle, and website context
// and return a structured BrandAnalysis object. Used to enrich the main
// concept-generation prompt with specific, accurate brand details.
async function analyzeBrand(
  apiKey: string,
  args: {
    vehicleB64?: string
    logoB64?: string
    websiteContext: string | null
    vehicle?: string
    bizName?: string
    bizType?: string
    colorsText: string
  },
): Promise<BrandAnalysis | null> {
  const content: Array<
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'text'; text: string }
  > = []

  if (args.vehicleB64) {
    const v = stripDataPrefix(args.vehicleB64)
    content.push({ type: 'image', source: { type: 'base64', media_type: v.media_type, data: v.data } })
  }
  if (args.logoB64) {
    const l = stripDataPrefix(args.logoB64)
    content.push({ type: 'image', source: { type: 'base64', media_type: l.media_type, data: l.data } })
  }

  const lines: (string | null)[] = [
    'Analyze the images and brand details below. Return ONLY a JSON object matching the schema at the bottom — no prose, no markdown fences.',
    '',
    'Image order: first image is the VEHICLE photo, second (if present) is the LOGO.',
    '',
    'INPUTS',
    args.vehicle ? `- Vehicle description: ${args.vehicle}` : null,
    args.bizName ? `- Business name: ${args.bizName}` : null,
    args.bizType ? `- Industry: ${args.bizType}` : null,
    args.colorsText ? `- Stated brand colors: ${args.colorsText}` : null,
    '',
    args.websiteContext ? 'WEBSITE CONTEXT' : null,
    args.websiteContext,
    args.websiteContext ? '' : null,
    'SCHEMA (return ONLY this JSON object):',
    '{',
    '  "logoColors": ["#hex", ...],            // 2–5 dominant hex colors pulled from the logo',
    '  "logoDescription": "string",             // overall visual description of the logo',
    '  "logoIconDescription": "string",         // specific shapes, icons, or marks (e.g. "circular Q mark with swoosh lines")',
    '  "fontStyle": "string",                    // e.g. "bold condensed sans-serif, all-caps"',
    '  "brandPersonality": "string",             // e.g. "energetic, technical, trustworthy"',
    '  "websitePrimaryServices": ["string", ...], // 2–5 services inferred from the site',
    '  "websiteColorTheme": "string",            // e.g. "navy + white with orange accents"',
    '  "vehicleBaseColor": "string",             // exact color of the vehicle body in the photo',
    '  "vehicleType": "string"                    // e.g. "crew-cab pickup truck, silver"',
    '}',
  ]
  content.push({ type: 'text', text: lines.filter((s): s is string => s != null).join('\n') })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system:
          'You are a brand analyst. You study logos, vehicles, and business context, then return precise structured analysis. Be specific (exact hex colors, exact vehicle type). Respond ONLY with the JSON object requested. No prose, no markdown fences.',
        messages: [{ role: 'user', content }],
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('[claude-proxy] analyzeBrand HTTP', res.status, errText.slice(0, 500))
      return null
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    const textBlock = (data.content ?? []).find((b) => b.type === 'text')?.text ?? ''
    const parsed = extractJson(textBlock) as BrandAnalysis | null
    if (!parsed) {
      console.error('[claude-proxy] analyzeBrand returned non-JSON:', textBlock.slice(0, 800))
      return null
    }
    return parsed
  } catch (e) {
    console.error('[claude-proxy] analyzeBrand exception:', e instanceof Error ? e.message : e)
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

    // Best-effort site fetch — used below AND passed into the analysis pass.
    const websiteContext = website ? await fetchWebsiteContext(website) : null
    console.log(
      '[claude-proxy] Website context:',
      websiteContext ? `(${websiteContext.length} chars)\n${websiteContext}` : '(none)',
    )

    // Normalize colors: accept either an array of hex strings OR a raw
    // free-text description (e.g. "Green #93ca3b and Fuchsia #ee2b7b").
    const colorsDisplay = Array.isArray(colors)
      ? colors.filter((c) => typeof c === 'string' && c.trim()).slice(0, 6).join(', ')
      : (typeof colors === 'string' ? colors.trim() : '')

    // Pass 1 — brand analysis. Returns structured details about the logo,
    // vehicle, and website that we inject into the main generation prompt.
    const brandAnalysis = await analyzeBrand(key, {
      vehicleB64,
      logoB64,
      websiteContext,
      vehicle,
      bizName,
      bizType,
      colorsText: colorsDisplay,
    })
    console.log('[claude-proxy] Brand analysis:', JSON.stringify(brandAnalysis, null, 2))

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
        ? "- The customer uploaded their logo as a BASE64 image. You can see it in the conversation. Study it carefully and extract:\n  • The exact dominant colors with hex codes\n  • The icon/symbol style (circular Q mark with swoosh lines for QMI, etc)\n  • Font style and weight\n  • Overall brand personality\nThen in EVERY concept's fal_prompt, describe the logo elements in detail so FLUX Kontext can recreate them accurately on the vehicle. Do NOT say 'place the logo' — instead describe exactly what the logo looks like visually so the AI can render it."
        : null,
      logoB64 ? '' : null,
      brandAnalysis ? 'BRAND ANALYSIS (auto-generated from logo + vehicle + website)' : null,
      brandAnalysis && brandAnalysis.logoColors?.length
        ? `- Logo colors: ${brandAnalysis.logoColors.join(', ')}` : null,
      brandAnalysis?.logoDescription ? `- Logo overall: ${brandAnalysis.logoDescription}` : null,
      brandAnalysis?.logoIconDescription ? `- Logo icon/mark: ${brandAnalysis.logoIconDescription}` : null,
      brandAnalysis?.fontStyle ? `- Logo font style: ${brandAnalysis.fontStyle}` : null,
      brandAnalysis?.brandPersonality ? `- Brand personality: ${brandAnalysis.brandPersonality}` : null,
      brandAnalysis && brandAnalysis.websitePrimaryServices?.length
        ? `- Primary services (from site): ${brandAnalysis.websitePrimaryServices.join(', ')}` : null,
      brandAnalysis?.websiteColorTheme ? `- Website color theme: ${brandAnalysis.websiteColorTheme}` : null,
      brandAnalysis?.vehicleBaseColor ? `- Vehicle base color: ${brandAnalysis.vehicleBaseColor}` : null,
      brandAnalysis?.vehicleType ? `- Vehicle type: ${brandAnalysis.vehicleType}` : null,
      brandAnalysis ? '' : null,
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

    const finalUserPrompt = promptLines.join('\n')
    userContent.push({ type: 'text', text: finalUserPrompt })
    console.log('[claude-proxy] Final user prompt to Claude:\n' + finalUserPrompt)

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

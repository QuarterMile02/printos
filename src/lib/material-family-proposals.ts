// Substrate FAMILY (line + thickness, with colours) migrate-proposal
// generation — material redesign Build 1b.
//
// Ruben's confirmed decision this rewrites the grouping around:
//   Material  = product line + thickness (e.g. "Acrylic .118in - 1/8"")
//   Colours   = material_colors rows on that material
//   Variants  = sheet sizes, and a size belongs to a COLOUR, not just
//               the material
// Thickness stays part of material identity. Colour does not.
//
// NOT WIRED TO THE UI. This module is deliberately separate from
// material-migrate-proposals.ts's buildSubstrateProposals (Build 1,
// still what the migrate screen actually calls) — per instruction,
// nothing here changes until the family/colour numbers below are
// reviewed and approved. Reuses that module's validated size-token
// regex (via stripSizeToken) rather than re-implementing it, per
// instruction ("reuse the validated size-token regex").
//
// BE CONSERVATIVE (the instruction's own words): Acrylic's "Colour
// (Code)" shape does not generalise to Coroplast, ACM, PVC, aluminum,
// etc. Every confidence check below exists because a REAL row in the
// live 235-row dataset broke a simpler version of this parser — see the
// comment above each one for the specific row that caused it. When a
// row isn't confidently parseable, it is emphatically NOT grouped with
// anything — it becomes its own singleton family (Confidence 'low'),
// same shape as a family with one colour and no size token. Under-
// grouping costs a manual merge later; over-grouping welds two real
// materials together silently. Those are not symmetric risks.

import { stripSizeToken, type ShopvoxMaterialRow } from './material-migrate-proposals'

export type FamilyConfidence = 'high' | 'medium' | 'low'

export type FamilyVariant = {
  sourceRowId: string
  sourceName: string
  sizeToken: string | null
}

export type FamilyColourGroup = {
  colourName: string | null // null = no colour word found in the name at all
  code: string | null
  variants: FamilyVariant[]
}

export type FamilyProposal = {
  key: string
  line: string
  thickness: string | null
  categoryId: string | null
  materialTypeId: string | null
  confidence: FamilyConfidence
  reasoning: string
  sourceRowIds: string[]
  colours: FamilyColourGroup[]
}

// ── Thickness extraction ────────────────────────────────────────────
// Handles every unit shape observed in the live 235-row dataset:
// ".118in - 1/8"" / ".25in - 1/4" (Falconboard, no trailing quote) /
// "1in" / "1.5in - 1 3/4"" / "3mm"/"10mm" (Coroplast/ACM) / "11 Guage"
// (Steel) / bare ".040"/".063"/".080" with NO unit at all (Aluminum
// Solid's gauge convention — the one shape the regex below can't catch
// on its own, handled by the bare-decimal fallback).
const THICKNESS_START_RE = /(\.\d+|\d+(?:\.\d+)?)\s*(in|mm)\b|(\d+)\s*Guage/i
const BARE_DECIMAL_THICKNESS_RE = /^\.\d{2,4}$/

function findThicknessStart(remainder: string): number {
  const m = remainder.match(THICKNESS_START_RE)
  if (m && m.index !== undefined) return m.index
  // Aluminum gauge style: the whole remainder ends in a bare ".040" with
  // no unit — treat the last whitespace-delimited word as thickness.
  const words = remainder.split(/\s+/)
  const last = words[words.length - 1]
  if (last && BARE_DECIMAL_THICKNESS_RE.test(last)) return remainder.length - last.length
  return -1
}

// A colour code in parens is the one HIGH-signal, unambiguous marker in
// this whole dataset: "ColourName (CODE)". Confirmed live it correctly
// captures Acrylic's ~60 coded colours (White (7328), Black (2025), ...)
// and does NOT require the code to be numeric — ADA's (CC3X2-500M) and
// (3X1-501) match the same shape (those are real colour codes here,
// unlike Build 1 where the same strings were false positives for the
// unrelated SIZE token — different regex, different purpose).
const COLOUR_CODE_RE = /^(.*?)\(([A-Za-z0-9][A-Za-z0-9-]*)\)(.*)$/

function parseRemainder(remainder: string): { colour: string | null; code: string | null; thickness: string | null } {
  const codeMatch = remainder.match(COLOUR_CODE_RE)
  if (codeMatch) {
    return { colour: codeMatch[1].trim() || null, code: codeMatch[2], thickness: codeMatch[3].trim() || null }
  }
  const idx = findThicknessStart(remainder)
  if (idx === -1) return { colour: remainder.trim() || null, code: null, thickness: null }
  return { colour: remainder.slice(0, idx).trim() || null, code: null, thickness: remainder.slice(idx).trim() || null }
}

function normWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, '')
}
function normWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
}

type PreparedRow = {
  row: ShopvoxMaterialRow
  words: string[] // size-token-stripped name, split on whitespace, ORIGINAL casing
  sizeToken: string | null
}

function prepareRow(row: ShopvoxMaterialRow): PreparedRow {
  const { familyName: nameNoSize, token } = stripSizeToken(row.name)
  return { row, words: nameNoSize.split(/\s+/).filter(Boolean), sizeToken: token?.raw ?? null }
}

// LINE = the longest word-for-word prefix shared by EVERY row in the
// same category, computed empirically from the data rather than
// guessed from the category's own label text. Deliberately NOT the
// category name itself — confirmed live those routinely diverge from
// the actual product name text (category "Corton Steel" vs name "Steel
// Corton...", word order reversed; category "Aluminum Solid" vs name
// just "Aluminum ..."; category "Corrugated Plastic" vs name
// "Coroplast ..." — no shared words at all). Using category_id as a
// hard GROUPING PARTITION (rows from different categories can never
// merge into the same family, regardless of what their LCP text says)
// while deriving the LINE DISPLAY TEXT from real per-category word
// agreement is what correctly separates "Acrylic" (LCP "Acrylic", 79
// rows) from "Acrylic Digital" (LCP "Acrylic Digital", its own
// category, 6 rows) without hand-listing product line names anywhere.
function computeLcpWordCount(items: PreparedRow[]): number {
  if (items.length === 0) return 1
  let lcp = items[0].words.map(normWord)
  for (const it of items.slice(1)) {
    const w = it.words.map(normWord)
    let n = 0
    while (n < lcp.length && n < w.length && lcp[n] === w[n]) n++
    lcp = lcp.slice(0, n)
  }
  return Math.max(lcp.length, 1)
}

export function buildFamilyProposals(rows: ShopvoxMaterialRow[], categoryNames: Map<string, string>): FamilyProposal[] {
  const prepared = rows.map(prepareRow)

  const byCategory = new Map<string, PreparedRow[]>()
  for (const p of prepared) {
    const key = p.row.category_id ?? '__none__'
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key)!.push(p)
  }

  const lcpByCategory = new Map<string, number>()
  for (const [catKey, items] of byCategory) lcpByCategory.set(catKey, computeLcpWordCount(items))

  // Restricted to categories actually present in THIS row set — the
  // org's full category list spans every material type (film, vinyl,
  // etc.), and a substrate colour word can innocently collide with an
  // unrelated category used elsewhere (confirmed live: "Clear" as a
  // colour vs a real "Clear Film" category used for vinyl, nothing to
  // do with substrates — checking against the full org list produced a
  // false positive here; restricting to used categories fixed it).
  const usedCategoryIds = new Set(rows.map((r) => r.category_id).filter((id): id is string => !!id))
  const categoryNameFirstWords = new Map<string, string>() // categoryId -> its own first normalized word, for the exclusion check below
  for (const id of usedCategoryIds) {
    const name = categoryNames.get(id)
    if (name) categoryNameFirstWords.set(id, normWords(name)[0] ?? '')
  }
  const otherCategoryFirstWords: string[] = [...usedCategoryIds]
    .map((id) => categoryNames.get(id))
    .filter((n): n is string => !!n)
    .map((n) => normWords(n)[0])
    .filter(Boolean)

  type Parsed = {
    prepared: PreparedRow
    line: string
    colour: string | null
    code: string | null
    thickness: string | null
    confidence: FamilyConfidence
    reasons: string[]
  }

  const parsedRows: Parsed[] = prepared.map((p) => {
    const catKey = p.row.category_id ?? '__none__'
    const catRows = byCategory.get(catKey)!
    const catRowCount = catRows.length
    const lineWordCount = Math.min(lcpByCategory.get(catKey) ?? 1, p.words.length)
    const line = p.words.slice(0, lineWordCount).join(' ')
    const remainder = p.words.slice(lineWordCount).join(' ')
    const { colour, code, thickness } = parseRemainder(remainder)

    const reasons: string[] = []
    let confidence: FamilyConfidence = 'high'

    // Real row that caused this: PETG ("PETG Clear .020in", the only
    // row in its category) and Steel Corton (2 rows that are IDENTICAL
    // after size-stripping) both let the category-wide LCP swallow the
    // ENTIRE name — there's nothing left to compare against with fewer
    // than 3 examples, so the "line" ends up being the whole string and
    // nothing gets parsed. Flagged explicitly rather than surfacing as
    // a confusing "no thickness found" a few lines down.
    if (catRowCount <= 2) {
      confidence = 'low'
      reasons.push(`only ${catRowCount} row(s) in this category — not enough repetition to trust an automated line/colour split; review manually`)
    }

    // Real row: "Coroplast 4mm (COLOR)" — a literal unfinished ShopVOX
    // placeholder, not a real colour value.
    if (code && code.toUpperCase() === 'COLOR') {
      confidence = 'low'
      reasons.push('the "colour" is a literal template placeholder, "(COLOR)", not a real value — looks like an unfinished ShopVOX record')
    }

    if (!thickness && confidence !== 'low') {
      confidence = 'low'
      reasons.push('no thickness token found')
    }

    // Real row: every Coroplast row ("Coroplast 4mm White", "Coroplast
    // 10mm White", ...) puts THICKNESS immediately after the line,
    // before colour — the opposite of every other product's line→
    // colour→thickness order. Detected structurally: colour zone empty,
    // and the text right after the matched number+unit starts with a
    // capitalized word rather than a fraction/dash continuation (which
    // would be normal, e.g. ".118in - 1/8"").
    if (thickness && !colour && confidence !== 'low') {
      const afterUnit = thickness.replace(/^(\.\d+|\d+(?:\.\d+)?)\s*(in|mm)\b\.?/i, '').trim()
      if (/^[A-Z]/.test(afterUnit) && !/^[-\d/"]/.test(afterUnit)) {
        confidence = 'low'
        reasons.push(`thickness token appears before any colour text ("${thickness}") — likely colour follows thickness in this product's naming, not the assumed line→colour→thickness order`)
      }
    }

    // Real row: "ADA Acrylic Color Cast Blue (CC3X2-500M)" — category
    // "ADA Signs" LCPs to just "ADA" (1 word), leaving "Acrylic Color
    // Cast Blue" as the "colour" — but "Acrylic" is ITSELF a real
    // product category in this dataset (a totally different substrate).
    // A colour word colliding with another category's name is a strong
    // signal it's actually a sub-line reference, not a genuine colour.
    if (confidence !== 'low' && colour) {
      const firstWord = normWord(colour.split(/\s+/)[0])
      const thisCategoryFirstWord = categoryNameFirstWords.get(p.row.category_id ?? '') ?? ''
      if (otherCategoryFirstWords.includes(firstWord) && firstWord !== thisCategoryFirstWord) {
        confidence = 'low'
        reasons.push(`colour text starts with "${colour.split(/\s+/)[0]}", which is itself another material category's name in this dataset — likely a sub-line qualifier, not a real colour`)
      }
    }

    // Real row: "Acrylic P95 Clear/ Matte" / "Acrylic P95 Bottle Green
    // (3030 Clear/ Matte)" — "P95" is an acrylic GRADE, not a colour,
    // but it has no category of its own to catch it with the check
    // above. A colour adjective is plain English and doesn't carry a
    // digit; a grade/line code like "P95" does.
    if (confidence !== 'low' && colour) {
      const firstWord = colour.split(/\s+/)[0]
      if (/\d/.test(firstWord)) {
        confidence = 'low'
        reasons.push(`colour text starts with "${firstWord}", which contains a digit — looks like a grade/line code (e.g. "P95"), not a plain colour word`)
      }
    }

    // Real row: "ADA Alternative Blue (3X1-501)" — category "ADA Signs"
    // (2-word official name) LCPs to just "ADA" across its 8 rows, and
    // this particular sub-group isn't caught by either check above
    // ("Alternative" matches no other category, has no digit). Kept
    // grouped (not demoted to singleton) but flagged for a second look
    // — small category, official name longer than the text agreement,
    // genuinely uncertain rather than confidently wrong.
    const catWordCount = categoryNames.has(p.row.category_id ?? '') ? normWords(categoryNames.get(p.row.category_id ?? '')!).length : 1
    if (confidence === 'high' && lineWordCount === 1 && catWordCount >= 2 && catRowCount < 10) {
      confidence = 'medium'
      reasons.push(`category "${categoryNames.get(p.row.category_id ?? '') ?? '?'}" has a ${catWordCount}-word name but rows only share a 1-word text prefix, and the category is small (${catRowCount} rows) — line identity is plausible but not independently confirmed`)
    }

    if (confidence === 'high' && reasons.length === 0) {
      reasons.push(colour ? `parsed cleanly: line "${line}", colour "${colour}"${code ? ` (${code})` : ''}, thickness "${thickness}"` : `parsed cleanly: line "${line}", no colour word, thickness "${thickness}"`)
    }

    return { prepared: p, line, colour, code, thickness, confidence, reasons }
  })

  // LOW confidence rows are NEVER grouped by the parsed line/thickness —
  // each becomes its own singleton family, same discipline as Build 1's
  // migrate proposals for anything the parser isn't sure about.
  const families = new Map<string, Parsed[]>()
  for (const p of parsedRows) {
    const key = p.confidence === 'low'
      ? `SINGLETON::${p.prepared.row.id}`
      : `${p.prepared.row.category_id ?? '__none__'}||${p.line.toLowerCase()}||${(p.thickness ?? '').toLowerCase()}`
    if (!families.has(key)) families.set(key, [])
    families.get(key)!.push(p)
  }

  const proposals: FamilyProposal[] = []
  for (const [key, items] of families) {
    const colourGroups = new Map<string, FamilyColourGroup>()
    for (const it of items) {
      const cKey = `${it.colour ?? ''}||${it.code ?? ''}`
      if (!colourGroups.has(cKey)) colourGroups.set(cKey, { colourName: it.colour, code: it.code, variants: [] })
      colourGroups.get(cKey)!.variants.push({
        sourceRowId: it.prepared.row.id,
        sourceName: it.prepared.row.name,
        sizeToken: it.prepared.sizeToken,
      })
    }

    proposals.push({
      key,
      line: items[0].line,
      thickness: items[0].thickness,
      categoryId: items[0].prepared.row.category_id,
      materialTypeId: items[0].prepared.row.material_type_id,
      confidence: items[0].confidence,
      reasoning: [...new Set(items.flatMap((it) => it.reasons))].join(' | '),
      sourceRowIds: items.map((it) => it.prepared.row.id),
      colours: [...colourGroups.values()],
    })
  }

  return proposals.sort((a, b) => b.sourceRowIds.length - a.sourceRowIds.length)
}

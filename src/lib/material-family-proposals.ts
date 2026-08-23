// Product-FAMILY (line + identity axis, with colour/finish) migrate-
// proposal generation — material redesign Build 1b, generalized per
// instruction ("GENERALISE THE PARSER NOW, don't special-case
// substrates. Ruben's next pass is kiss-cut / colour vinyl, which is
// the SAME shape... except the identity axis is mil instead of sheet
// thickness, and sizes are roll widths with a length rather than sheet
// H×W.").
//
// Ruben's confirmed decision this rewrites the grouping around:
//   Material  = product line + identity axis (e.g. "Acrylic .118in -
//               1/8"" for substrates — a future vinyl pass would use
//               "Avery SW900 3mil")
//   Colour/Finish = material_colors rows on that material (the label is
//               "Colour / Finish" in the UI, not "Colour" — the real
//               data includes Mill, Brite Brushed Gold, Painted 1 Side:
//               finishes and prep states, not colours. Table name and
//               internal field names stay "colour" — only the UI-facing
//               word changes, see migrate-client.tsx)
//   Variants  = sizes, and a size belongs to a COLOUR/FINISH, not just
//               the material
// The identity axis stays part of material identity. Colour/finish does
// not.
//
// NOT WIRED TO THE UI in this file's PRIOR revision — as of this pass
// it IS wired (see migrate-client.tsx / page.tsx / actions.ts), per
// Ruben's "Numbers approved... Proceed to the UI."
//
// GENERALIZATION SHAPE: buildFamilyProposals takes a FamilyAxisConfig
// instead of hardcoding "thickness". SUBSTRATE_FAMILY_CONFIG below is
// the only concrete config that exists today — it reproduces Build 1b's
// exact validated substrate behavior (235 rows → 102 families, unchanged
// by this refactor, re-verified). A future roll/vinyl config plugs in
// without touching buildFamilyProposals, the colour/code parsing, or
// any of the five confidence checks — see the "WHAT A ROLL PASS WOULD
// STILL NEED" comment at the bottom of this file for exactly what's
// missing (deliberately not built here).

import { stripSizeToken, extractCutToLengthWidth, type ShopvoxMaterialRow } from './material-migrate-proposals'
import { findRollAxisSpan } from './roll-axis-regex.js'

// Single source of truth for both material type names this file has a
// config for — page.tsx imports these rather than re-declaring the
// literal, so the type-picker default and FAMILY_CONFIGS below can
// never drift apart.
export const SUBSTRATE_TYPE_NAME = 'Rigid Substrates- Sheets'
export const ROLL_TYPE_NAME = 'Roll Materials'

export type FamilyConfidence = 'high' | 'medium' | 'low'

export type FamilyVariant = {
  sourceRowId: string
  sourceName: string
  sizeLabel: string | null
  height: number | null
  width: number | null
  lengthIncrement: number | null // non-null = cut-to-length (e.g. Polycarbonate reel rows)
}

export type FamilyColourGroup = {
  colourName: string | null // null = no colour/finish word found in the name at all
  code: string | null
  variants: FamilyVariant[]
}

export type FamilyProposal = {
  key: string
  line: string
  axisLabel: string // e.g. "Thickness" — display label for axisValue, from the config
  axisValue: string | null
  // Brand / product-line marker (e.g. "Oracal 651", "Avery SW900", "3M
  // 180C") — rolls only (always null for configs without findAxisSpan).
  // FAMILY-DISTINGUISHING, confirmed by Ruben: two vinyls identical
  // except brand are different materials (different cost, different
  // vendor). Goes into the generated family NAME as plain text — there
  // is deliberately no database column for it; nothing reads it as
  // structured data, and adding an unread column is the exact failure
  // mode this project keeps hitting.
  brand: string | null
  categoryId: string | null
  materialTypeId: string | null
  confidence: FamilyConfidence
  reasoning: string
  sourceRowIds: string[]
  colours: FamilyColourGroup[]
}

// ── Pluggable axes ───────────────────────────────────────────────────
// The two things that differ between substrates and (future) rolls:
// what the IDENTITY axis looks like in text (sheet thickness vs vinyl
// mil), and what a SIZE looks like (sheet H×W token vs roll width+
// length). Everything else — line derivation, colour/code parsing, the
// five confidence checks, family grouping — is identical for both, so
// none of it is parameterized; only these two extraction concerns are.
export type FamilyAxisConfig = {
  // Display label for the identity axis, used in the family's axisLabel
  // field and in reasoning text (e.g. "Thickness", "Mil").
  axisLabel: string
  // Given the remainder of a name after the line and colour/code have
  // been removed, return the index where the identity-axis token
  // starts, or -1 if none is found. Substrate implementation below
  // handles ".118in - 1/8"", "3mm", "11 Guage", bare ".040" (no unit).
  findAxisStart: (remainder: string) => number
  // Optional. Substrate's axis is "everything from findAxisStart to the
  // end of the remainder" — the trailing decoration on the name (e.g.
  // ".118in - 1/8""). Rolls are different: the axis is a single bounded
  // TOKEN (e.g. "2Mil"), and text that follows it is the brand/product-
  // line marker (Oracal 651, Avery SW900, 3M 180C) — a separate,
  // family-distinguishing field, never folded into axisValue or colour.
  // When a config provides this, parseRemainder uses it instead of
  // findAxisStart to get an exact [start,end) span and captures
  // whatever follows as `brand`. findAxisStart is still required on
  // every config (suggestParentMaterials uses it for an approximate
  // line/axis split on existing materials) — a findAxisSpan config can
  // just return that span's start.
  findAxisSpan?: (remainder: string) => { start: number; end: number } | null
  // Given the full row (name text AND the row's own stored dimensions —
  // needed because a cut-to-length row's real width lives in the row,
  // not always recoverable from text alone), strip whatever this axis
  // config considers a "size" token and return the remainder plus the
  // resolved size fields for the resulting variant. Substrate
  // implementation reuses Build 1's validated sheet-size regex
  // (stripSizeToken) for normal WxH tokens, and Build 1's cut-to-length
  // extraction (extractCutToLengthWidth) for the reel-width case.
  extractSize: (row: ShopvoxMaterialRow) => {
    nameWithoutSize: string
    sizeLabel: string | null
    height: number | null
    width: number | null
    lengthIncrement: number | null
  }
}

// ── Substrate identity axis: sheet/gauge thickness ──────────────────
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
  // no unit — treat the last whitespace-delimited word as the axis.
  const words = remainder.split(/\s+/)
  const last = words[words.length - 1]
  if (last && BARE_DECIMAL_THICKNESS_RE.test(last)) return remainder.length - last.length
  return -1
}

// Removes a cut-to-length width match (the same one extractCutToLengthWidth
// finds — a bare "NNin" not part of a decimal thickness fraction) from
// the string, along with any trailing decoration after it (e.g. "Reel
// Ln Ft" — never stored anywhere, so safe to drop entirely). Regressing
// this from Build 1 would have been easy to miss: without it, the
// identity-axis parser below sees the trailing width as part of the
// axis text (e.g. axisValue becomes ".150in - 3/16" 52in" instead of
// ".150in - 3/16""), and every one of the 6 same-thickness/colour
// Polycarbonate reel rows ends up in its OWN 1-row family instead of
// correctly grouping as 6 size variants under one "Polycarbonate White
// .150in - 3/16"" family — confirmed live, this is exactly what
// happened before this fix.
const BARE_WIDTH_RE = /(\d+(?:\.\d+)?)in\b/gi
function stripCutToLengthWidth(name: string): string {
  let lastIndex = -1
  for (const m of name.matchAll(BARE_WIDTH_RE)) {
    if (name[m.index! - 1] === '.') continue
    lastIndex = m.index!
  }
  if (lastIndex === -1) return name
  return name.slice(0, lastIndex).replace(/[\s,-]+$/, '').trim()
}

export const SUBSTRATE_FAMILY_CONFIG: FamilyAxisConfig = {
  axisLabel: 'Thickness',
  findAxisStart: findThicknessStart,
  extractSize: (row) => {
    const { familyName: nameNoSize, token } = stripSizeToken(row.name)
    if (token) {
      // A normal WxH sheet size was found in the name — use the ROW'S
      // OWN stored height/width (already correctly populated from the
      // original scrape), not re-derived from the token text.
      return { nameWithoutSize: nameNoSize, sizeLabel: token.raw, height: row.height, width: row.width, lengthIncrement: null }
    }
    // No WxH token. Only trust a cut-to-length reading when the row
    // genuinely has NO stored dimensions of its own (Build 1's exact
    // gate) — a row that already has real width/height must keep them,
    // never override real stored data with a text guess.
    if (row.height == null && row.width == null) {
      const width = extractCutToLengthWidth(nameNoSize)
      if (width != null) {
        return {
          nameWithoutSize: stripCutToLengthWidth(nameNoSize),
          sizeLabel: `${width}in (cut-to-length)`,
          height: null,
          width,
          lengthIncrement: 12, // Build 1's confirmed Polycarbonate reel increment
        }
      }
    }
    // No size token of any kind — the "default" variant, using the
    // row's own dimensions as-is (null/null if it genuinely has neither).
    return { nameWithoutSize: nameNoSize, sizeLabel: null, height: row.height, width: row.width, lengthIncrement: null }
  },
}

// A colour/finish code in parens is the one HIGH-signal, unambiguous
// marker in this whole dataset: "ColourName (CODE)". Confirmed live it
// correctly captures Acrylic's ~60 coded colours (White (7328), Black
// (2025), ...) and does NOT require the code to be numeric — ADA's
// (CC3X2-500M) and (3X1-501) match the same shape (those are real
// colour codes here, unlike Build 1 where the same strings were false
// positives for the unrelated SIZE token — different regex, different
// purpose). Generic across axes — not part of FamilyAxisConfig.
const COLOUR_CODE_RE = /^(.*?)\(([A-Za-z0-9][A-Za-z0-9-]*)\)(.*)$/

function parseRemainder(remainder: string, config: FamilyAxisConfig): { colour: string | null; code: string | null; axisValue: string | null; brand: string | null } {
  const codeMatch = remainder.match(COLOUR_CODE_RE)

  if (config.findAxisSpan) {
    // Roll-style: axis is a bounded token; text after it is brand. The
    // colour/code shape ("ColourName (CODE) ...") is unchanged/shared —
    // only what happens to the text AFTER the code differs from
    // substrates below.
    const afterColour = codeMatch ? codeMatch[3] : remainder
    const colourFromCode = codeMatch ? (codeMatch[1].trim() || null) : null
    const code = codeMatch ? codeMatch[2] : null
    const span = config.findAxisSpan(afterColour)
    if (!span) {
      return { colour: codeMatch ? colourFromCode : (remainder.trim() || null), code, axisValue: null, brand: null }
    }
    const axisValue = afterColour.slice(span.start, span.end).trim() || null
    const brand = afterColour.slice(span.end).trim() || null
    const colour = codeMatch ? colourFromCode : (afterColour.slice(0, span.start).trim() || null)
    return { colour, code, axisValue, brand }
  }

  // Substrate-style (unchanged): axis is "rest of remainder from
  // findAxisStart to the end" — no separate brand concept.
  if (codeMatch) {
    return { colour: codeMatch[1].trim() || null, code: codeMatch[2], axisValue: codeMatch[3].trim() || null, brand: null }
  }
  const idx = config.findAxisStart(remainder)
  if (idx === -1) return { colour: remainder.trim() || null, code: null, axisValue: null, brand: null }
  return { colour: remainder.slice(0, idx).trim() || null, code: null, axisValue: remainder.slice(idx).trim() || null, brand: null }
}

function normWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, '')
}
function normWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
}

type PreparedRow = {
  row: ShopvoxMaterialRow
  words: string[] // size-stripped name, split on whitespace, ORIGINAL casing
  sizeLabel: string | null
  height: number | null
  width: number | null
  lengthIncrement: number | null
}

function prepareRow(row: ShopvoxMaterialRow, config: FamilyAxisConfig): PreparedRow {
  const { nameWithoutSize, sizeLabel, height, width, lengthIncrement } = config.extractSize(row)
  return { row, words: nameWithoutSize.split(/\s+/).filter(Boolean), sizeLabel, height, width, lengthIncrement }
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
// Axis-independent — reused as-is for any future config.
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
export function buildFamilyProposals(
  rows: ShopvoxMaterialRow[],
  categoryNames: Map<string, string>,
  config: FamilyAxisConfig = SUBSTRATE_FAMILY_CONFIG,
): FamilyProposal[] {
  const prepared = rows.map((r) => prepareRow(r, config))

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
  // etc.), and a colour/finish word can innocently collide with an
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
    axisValue: string | null
    brand: string | null
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
    const parsed = parseRemainder(remainder, config)
    const { colour, code, brand } = parsed
    let axisValue = parsed.axisValue

    // Roll-style only: some product lines carry an IDENTICAL axis value
    // on every row in the category (e.g. every "Banner Mesh" row is
    // "8oz") — the per-category longest-common-prefix naturally absorbs
    // that token into `line`, leaving nothing in `remainder` for the
    // above match to find. That's a structural non-failure (the axis is
    // right there, in `line`, visible in the family name), not a parse
    // miss — recheck `line` itself before concluding there's truly no
    // axis token anywhere. brand is not extracted in this branch: it's
    // shared/category-wide text already visible inside `line` itself,
    // nothing hidden.
    let axisFixedInLine = false
    if (config.findAxisSpan && !axisValue) {
      const lineSpan = config.findAxisSpan(line)
      if (lineSpan) {
        axisValue = line.slice(lineSpan.start, lineSpan.end).trim() || null
        axisFixedInLine = true
      }
    }

    const reasons: string[] = []
    let confidence: FamilyConfidence = 'high'

    // Real row that caused this: PETG ("PETG Clear .020in", the only
    // row in its category) and Steel Corton (2 rows that are IDENTICAL
    // after size-stripping) both let the category-wide LCP swallow the
    // ENTIRE name — there's nothing left to compare against with fewer
    // than 3 examples, so the "line" ends up being the whole string and
    // nothing gets parsed. Flagged explicitly rather than surfacing as
    // a confusing "no axis token found" a few lines down.
    if (catRowCount <= 2) {
      confidence = 'low'
      reasons.push(`only ${catRowCount} row(s) in this category — not enough repetition to trust an automated line/colour-finish split; review manually`)
    }

    // Real row: "Grommet" (Roll Materials) — no size token in the name
    // AND no stored width on the source row, so `extractSize` has
    // nothing to fall back to. This is a stronger warning than "no axis
    // token" and forces LOW regardless of config — never invent a size,
    // and never let a family/singleton with a genuinely unknown width
    // ride along at medium confidence just because its axis or line
    // looked fine.
    if (confidence !== 'low' && p.width == null) {
      confidence = 'low'
      reasons.push('no size available — no width token in the name and no stored width on the source row; needs manual entry')
    }

    // Real row: "Coroplast 4mm (COLOR)" — a literal unfinished ShopVOX
    // placeholder, not a real colour/finish value.
    if (code && code.toUpperCase() === 'COLOR') {
      confidence = 'low'
      reasons.push('the "colour/finish" is a literal template placeholder, "(COLOR)", not a real value — looks like an unfinished ShopVOX record')
    }

    if (axisFixedInLine) {
      // Non-blocking — just tells Ruben WHY axisValue is set even though
      // no per-row token was in the remainder, so this doesn't read as a
      // mysterious contradiction of the reasoning right below it.
      reasons.push(`${config.axisLabel.toLowerCase()} "${axisValue}" is constant for every row in this category — absorbed into the line, not a per-row miss`)
    }

    if (!axisValue && confidence !== 'low') {
      if (config.findAxisSpan) {
        // Roll-style only: confirmed live, a real and legitimate chunk
        // of the dataset (Pre-Mask Tape, some vinyl grades named only by
        // brand/model) carries no weight/thickness token anywhere —
        // that's honest, not a parser failure. Do NOT force a singleton
        // and do NOT invent an axis value — group by line/brand alone
        // (the grouping key below already does this once axisValue is
        // '') and flag it for a second look rather than hiding it as a
        // confident grouping.
        if (confidence === 'high') confidence = 'medium'
        reasons.push(`no ${config.axisLabel.toLowerCase()} token found — grouped by line${brand ? '/brand' : ''} alone`)
      } else {
        confidence = 'low'
        reasons.push(`no ${config.axisLabel.toLowerCase()} token found`)
      }
    }

    // Real row: every Coroplast row ("Coroplast 4mm White", "Coroplast
    // 10mm White", ...) puts the identity axis immediately after the
    // line, before colour — the opposite of every other product's
    // line→colour→axis order. Detected structurally: colour zone empty,
    // and the text right after the matched axis token starts with a
    // capitalized word rather than a fraction/dash continuation (which
    // would be normal, e.g. ".118in - 1/8"").
    if (axisValue && !colour && confidence !== 'low') {
      const afterUnit = axisValue.replace(/^(\.\d+|\d+(?:\.\d+)?)\s*(in|mm)\b\.?/i, '').trim()
      if (/^[A-Z]/.test(afterUnit) && !/^[-\d/"]/.test(afterUnit)) {
        confidence = 'low'
        reasons.push(`${config.axisLabel.toLowerCase()} token appears before any colour/finish text ("${axisValue}") — likely colour/finish follows the axis in this product's naming, not the assumed line→colour/finish→axis order`)
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
        reasons.push(`colour/finish text starts with "${colour.split(/\s+/)[0]}", which is itself another material category's name in this dataset — likely a sub-line qualifier, not a real colour/finish`)
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
        reasons.push(`colour/finish text starts with "${firstWord}", which contains a digit — looks like a grade/line code (e.g. "P95"), not a plain colour/finish word`)
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
      const brandSuffix = brand ? `, brand/line "${brand}"` : ''
      reasons.push(colour ? `parsed cleanly: line "${line}", colour/finish "${colour}"${code ? ` (${code})` : ''}, ${config.axisLabel.toLowerCase()} "${axisValue}"${brandSuffix}` : `parsed cleanly: line "${line}", no colour/finish word, ${config.axisLabel.toLowerCase()} "${axisValue}"${brandSuffix}`)
    }

    return { prepared: p, line, colour, code, axisValue, brand, confidence, reasons }
  })

  // LOW confidence rows are NEVER grouped by the parsed line/axis —
  // each becomes its own singleton family, same discipline as Build 1's
  // migrate proposals for anything the parser isn't sure about. Brand is
  // folded into the grouping key (roll-style configs only — always ''
  // for substrates, so this changes nothing for them): two vinyls
  // identical except brand are different materials, confirmed by Ruben —
  // never silently welded together because their line/axis happen to
  // match.
  const families = new Map<string, Parsed[]>()
  for (const p of parsedRows) {
    const key = p.confidence === 'low'
      ? `SINGLETON::${p.prepared.row.id}`
      : `${p.prepared.row.category_id ?? '__none__'}||${p.line.toLowerCase()}||${(p.axisValue ?? '').toLowerCase()}||${(p.brand ?? '').toLowerCase()}`
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
        sizeLabel: it.prepared.sizeLabel,
        height: it.prepared.height,
        width: it.prepared.width,
        lengthIncrement: it.prepared.lengthIncrement,
      })
    }

    proposals.push({
      key,
      line: items[0].line,
      axisLabel: config.axisLabel,
      axisValue: items[0].axisValue,
      brand: items[0].brand,
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

// ── Roll identity axis: weight (oz) or thickness (Mil) ───────────────
// Confirmed live over all 368 NEW "Roll Materials" rows (org
// 4ca12dff-97be-4472-8099-ab102a3af01a, 2026-08-22): 48 use oz
// (fabric/banner/mesh-class), 224 use Mil (vinyl/film/laminate-class),
// ZERO use both — two genuinely separate naming conventions, not one
// axis spelled two ways. See known-issues/2026-08-22-roll-vinyl-
// migrate-pass-proposal.md for the full investigation this implements.
// The actual regex (and the "Mil must never match ML" guarantee) lives
// in roll-axis-regex.js, not here — see that file's header for why, and
// scripts/verify-roll-axis-regex.mjs for the proof.

// Width — includes the bare quote-inch form (e.g. `54"`) from the
// start: confirmed live exactly one row uses it ("Roodle Matte White
// Removable 54" x 100"") without ever writing the word "in", and a
// substrate-style regex that only recognized "in" would silently
// misparse it as colour text (the exact THICKNESS_START_RE risk
// discovered on the Substrates type earlier this project).
const ROLL_WIDTH_X_LENGTH_RE = /(\d+(?:\.\d+)?)\s*(in|")\s*[x×]\s*(\d+(?:\.\d+)?)\s*(in|")/i
const ROLL_WIDTH_RE = /(\d+(?:\.\d+)?)\s*(in|")/i

// Cut-to-length (length_increment): checked directly against all 368
// rows — no true continuous-cut-to-length product exists in this
// dataset. 9 rows have DB width AND height both NULL (the Polycarbonate
// trigger shape), but 8 of the 9 carry an explicit, discrete width IN
// THE NAME (six stock widths of one "Banner Translucent" product) — a
// normal multi-width family, not a reel. The 9th ("Grommet") is not a
// sized roll product at all — no width signal of any kind, not
// special-cased, just falls through to the last resort below and
// surfaces as an honest LOW-confidence singleton. Because nothing in
// the live data exercises it, ROLL_FAMILY_CONFIG does not attempt
// length_increment detection — inventing a reel length for a row that
// doesn't need one would be exactly the kind of guess this file's rules
// forbid. If a genuine cut-to-length roll ever appears (DB width AND
// height both NULL, no width/inch token anywhere in the name, AND a
// price that's clearly length-scaled), it should be added the same way
// Build 1 added it for Polycarbonate — detected explicitly, not
// inferred from these three signals colliding by accident.

export const ROLL_FAMILY_CONFIG: FamilyAxisConfig = {
  axisLabel: 'Weight/Thickness',
  findAxisStart: (remainder) => findRollAxisSpan(remainder)?.start ?? -1,
  findAxisSpan: (remainder) => findRollAxisSpan(remainder),
  extractSize: (row) => {
    const wl = ROLL_WIDTH_X_LENGTH_RE.exec(row.name)
    if (wl) {
      // Two explicit dimensions in the name (e.g. "54in x 100in") — a
      // discrete stock size, not cut-to-length. Reuses the existing
      // height/width columns exactly as substrates' H×W does (no new
      // column): width = the roll width, height = the second dimension
      // as given. 40 rows in the live dataset carry this shape.
      const nameWithoutSize = (row.name.slice(0, wl.index) + row.name.slice(wl.index! + wl[0].length)).replace(/\s{2,}/g, ' ').trim()
      return { nameWithoutSize, sizeLabel: wl[0].trim(), height: parseFloat(wl[3]), width: parseFloat(wl[1]), lengthIncrement: null }
    }
    const w = ROLL_WIDTH_RE.exec(row.name)
    if (w) {
      const nameWithoutSize = (row.name.slice(0, w.index) + row.name.slice(w.index! + w[0].length)).replace(/\s{2,}/g, ' ').trim()
      return { nameWithoutSize, sizeLabel: w[0].trim(), height: row.height, width: parseFloat(w[1]), lengthIncrement: null }
    }
    // No width token in the name — fall back to the row's own stored
    // width (359/368 rows have one). Confirmed live: only ONE row in
    // the whole 368 has neither a text token nor a stored width
    // ("Grommet" — not a sized roll product, surfaces as its own LOW
    // singleton via the "no width available" check below, same as any
    // other unparseable row).
    if (row.width != null) {
      return { nameWithoutSize: row.name, sizeLabel: `${row.width}in (from ShopVOX record, no size in name)`, height: row.height, width: row.width, lengthIncrement: null }
    }
    return { nameWithoutSize: row.name, sizeLabel: null, height: row.height, width: null, lengthIncrement: null }
  },
}

// Name -> config lookup for the type-aware migrate screen (page.tsx).
// Deliberately small and flat — this is a migration tool with a limited
// lifespan, not a product surface. A material type with no entry here
// shows an explicit "no parser configured for this type yet" banner
// (page.tsx / migrate-client.tsx) rather than silently reusing the
// wrong config or rendering nothing.
export const FAMILY_CONFIGS: Record<string, FamilyAxisConfig> = {
  [SUBSTRATE_TYPE_NAME]: SUBSTRATE_FAMILY_CONFIG,
  [ROLL_TYPE_NAME]: ROLL_FAMILY_CONFIG,
}

// Substrate migrate-proposal generation — material redesign Build 1,
// item 12. Pure functions only (no DB access), so this can be unit-
// tested and reused by both the server component that renders the
// migrate screen and, later, a re-run when shopvox_materials rows change.
//
// SUBSTRATES ONLY this pass — callers are expected to have already
// filtered rows to material_type_id = "Rigid Substrates- Sheets" (the
// only type Finding A / this build's proposal rules were validated
// against). Passing other types through produces a proposal per row
// with confidence 'low' and a reasoning string saying so, rather than
// silently mis-grouping them.

export type ShopvoxMaterialRow = {
  id: string
  shopvox_id: string
  name: string
  material_type_id: string | null
  category_id: string | null
  width: number | null
  height: number | null
  sheet_cost: number | null
  cost: number | null
  price: number | null
  multiplier: number | null
  preferred_vendor: string | null
  part_number: string | null
  sku: string | null
  po_description: string | null
  info_url: string | null
  image_url: string | null
  description: string | null
  vendor_pricing: Array<{
    vendor_name: string | null
    price: number | null
    rank: number | null
    part_number: string | null
    part_name: string | null
    units: string | null
    delivery_fee: number | null
    width: number | null
    length: number | null
    sqft_price: number | null
    quantity: number | null
  }>
  status: 'NEW' | 'MIGRATED' | 'CHANGED' | 'DISMISSED'
}

// VALIDATED size-token regex (Build 1 Finding A + item 12 instruction:
// "use the VALIDATED token regex, not the naive one"). Requires an
// explicit unit (in/ft/yd/'/") immediately after the FIRST number —
// confirmed against all 235 Rigid Substrates- Sheets materials that this
// is exactly what separates every real size token ("4ft x 10ft", "50in
// x 120in", "74in x 98in") from the 7 ADA acrylic color-code false
// positives a naive \d.{0,4}x.{0,4}\d regex hits (CC3X2-500M, 3X1-501 —
// both bare digit-x-digit with no unit). Zero exceptions found in the
// live dataset.
//
// FIXED 2026-08-21 (Build 1b): added `(?<![\d.])` before the first
// number. Without it, a thickness restated as "in x fraction" — e.g.
// "Aluminum 5ft x 10ft Mill .125in x 1/8in" — let the regex start
// matching mid-decimal (skipping the leading "." of ".125in", or even
// mid-digit-run) and produced a bogus match like "125in x 1" or "25in x
// 1", which stripSizeToken then removed as if it were the sheet size —
// leaving the REAL size ("5ft x 10ft") untouched and garbling
// everything downstream. Confirmed this fix changes NOTHING about
// Build 1's own reported Finding A counts (235 total / 227 both-
// populated / 8 neither / 57 name-has-size — re-verified identical with
// the fix applied) since none of those 57 rows depended on the buggy
// behavior; the fix only stops a small set of Aluminum thickness-
// restatement rows from being mis-parsed as if the thickness were a
// second sheet size.
const SIZE_TOKEN_RE = /(?<![\d.])(\d+(?:\.\d+)?)\s*(in|ft|yd|'|")\s*[x×]\s*(\d+(?:\.\d+)?)\s*(in|ft|yd|'|")?/gi

// Bare "NNin" width extractor for the 8 cut-to-length Polycarbonate reel
// rows (Finding A: neither width nor height populated, no size TOKEN in
// the name — just a single trailing width like "52in"). Skips any match
// immediately preceded by "." so it doesn't grab the thickness fraction
// (".118in" / ".150in") that appears earlier in every one of these names.
const BARE_WIDTH_RE = /(\d+(?:\.\d+)?)in\b/gi

export type SizeToken = { raw: string; num1: number; unit1: string; num2: number; unit2: string | null }

export function stripSizeToken(name: string): { familyName: string; token: SizeToken | null } {
  const matches = [...name.matchAll(SIZE_TOKEN_RE)]
  if (matches.length === 0) return { familyName: name.trim(), token: null }
  // Last occurrence = "trailing" per the instruction's own wording, even
  // when the token sits mid-string rather than at the literal end (e.g.
  // "Acrylic 4ft x 10ft White (7328) .177in" — the size comes right after
  // the material name, color/thickness follow it). Confirmed live this
  // is what correctly re-unites e.g. "Acrylic 4ft x 10ft White (7328)
  // .177in - 3/16"" and "Acrylic White (7328) .177in - 3/16"" (the
  // no-token 48x96 default) into the same family.
  const m = matches[matches.length - 1]
  const familyName = (name.slice(0, m.index) + name.slice(m.index! + m[0].length))
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,-]+|[\s,-]+$/g, '')
    .trim()
  return {
    familyName,
    token: { raw: m[0].trim(), num1: parseFloat(m[1]), unit1: m[2].toLowerCase(), num2: parseFloat(m[3]), unit2: m[4] ? m[4].toLowerCase() : null },
  }
}

export function extractCutToLengthWidth(name: string): number | null {
  let last: number | null = null
  for (const m of name.matchAll(BARE_WIDTH_RE)) {
    const precedingChar = name[m.index! - 1]
    if (precedingChar === '.') continue // thickness fraction, e.g. ".118in" — not the width
    last = parseFloat(m[1])
  }
  return last
}

export type RowClass = 'cut_to_length' | 'sized' | 'default'

// A row is cut-to-length when it has NO stored width/height AND no size
// TOKEN (WxH pair) in its name — matches exactly Finding A's 8
// Polycarbonate "neither populated" rows, which do carry a single bare
// width number instead (e.g. "...52in Reel Ln Ft").
export function classifyRow(row: ShopvoxMaterialRow): RowClass {
  if (row.width == null && row.height == null && stripSizeToken(row.name).token === null) return 'cut_to_length'
  return stripSizeToken(row.name).token !== null ? 'sized' : 'default'
}

export type ProposedVariant = {
  height: number | null
  width: number | null
  lengthIncrement: number | null
  isDefault: boolean
  sourceRowId: string
  sourceName: string
}

export type Confidence = 'high' | 'medium' | 'low'

export type SubstrateProposal = {
  key: string
  familyName: string
  materialTypeId: string | null
  categoryId: string | null
  confidence: Confidence
  reasoning: string
  sourceRowIds: string[]
  variants: ProposedVariant[]
  vendorSeed: {
    vendorName: string
    vendorPrice: number | null
    partNumber: string | null
    rank: number | null
    fromRowId: string
  } | null
}

function pickVendorSeed(rows: ShopvoxMaterialRow[]): SubstrateProposal['vendorSeed'] {
  for (const row of rows) {
    const best = [...(row.vendor_pricing ?? [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0]
    if (best?.vendor_name) {
      return { vendorName: best.vendor_name, vendorPrice: best.price, partNumber: best.part_number, rank: best.rank, fromRowId: row.id }
    }
    if (row.preferred_vendor) {
      return { vendorName: row.preferred_vendor, vendorPrice: row.cost, partNumber: row.part_number, rank: null, fromRowId: row.id }
    }
  }
  return null
}

export function buildSubstrateProposals(rows: ShopvoxMaterialRow[]): SubstrateProposal[] {
  const groups = new Map<string, ShopvoxMaterialRow[]>()
  for (const row of rows) {
    const { familyName } = stripSizeToken(row.name)
    const key = `${familyName.toLowerCase()}|${row.material_type_id ?? ''}|${row.category_id ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  const proposals: SubstrateProposal[] = []
  for (const [key, groupRows] of groups) {
    const { familyName } = stripSizeToken(groupRows[0].name)
    const variants: ProposedVariant[] = []
    const reasons: string[] = []
    let anyCutToLength = false
    let anyUnparsedCutToLength = false

    for (const row of groupRows) {
      const cls = classifyRow(row)
      if (cls === 'cut_to_length') {
        anyCutToLength = true
        const width = extractCutToLengthWidth(row.name)
        if (width == null) anyUnparsedCutToLength = true
        variants.push({ height: null, width, lengthIncrement: 12, isDefault: false, sourceRowId: row.id, sourceName: row.name })
        reasons.push(`"${row.name}" → cut-to-length variant, width ${width ?? '?'}in extracted from the name, length_increment 12 (no stored dimensions, no size token — matches Finding A's Polycarbonate reel pattern)`)
      } else if (cls === 'default') {
        variants.push({ height: row.height, width: row.width, lengthIncrement: null, isDefault: true, sourceRowId: row.id, sourceName: row.name })
        reasons.push(`"${row.name}" → default variant at its existing ${row.width ?? '?'}×${row.height ?? '?'} (no size token in the name)`)
      } else {
        const { token } = stripSizeToken(row.name)
        variants.push({ height: row.height, width: row.width, lengthIncrement: null, isDefault: false, sourceRowId: row.id, sourceName: row.name })
        reasons.push(`"${row.name}" → sized variant ${row.width ?? '?'}×${row.height ?? '?'}, stripped token "${token?.raw}"`)
      }
    }

    // At most one is_default — if the group produced zero (e.g. every
    // row in the family carries a size token, no bare default exists),
    // mark the first as default so the proposal always has one, flagged
    // in the reasoning so it's visible before acceptance, not silently
    // assumed.
    let markedDefault = variants.some((v) => v.isDefault)
    if (!markedDefault && variants.length > 0 && !anyCutToLength) {
      variants[0].isDefault = true
      reasons.push(`No no-token row found in this family — defaulted "${variants[0].sourceName}" to is_default since a family needs exactly one.`)
      markedDefault = true
    }

    let confidence: Confidence = 'high'
    if (anyUnparsedCutToLength) confidence = 'low'
    else if (groupRows.length > 1) confidence = 'medium' // any string-based multi-row grouping deserves a second look
    else if (!markedDefault && !anyCutToLength) confidence = 'medium'

    proposals.push({
      key,
      familyName,
      materialTypeId: groupRows[0].material_type_id,
      categoryId: groupRows[0].category_id,
      confidence,
      reasoning: reasons.join(' | '),
      sourceRowIds: groupRows.map((r) => r.id),
      variants,
      vendorSeed: pickVendorSeed(groupRows),
    })
  }

  return proposals.sort((a, b) => a.familyName.localeCompare(b.familyName))
}

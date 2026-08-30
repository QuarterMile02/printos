// Suggested parent materials for a singleton migrate proposal -- item 2
// of the "add to existing material" build. Pure functions, no DB
// access -- called from the client with data already loaded by the
// server component.
//
// Ruben's own ranking order: "Rank on the parsed line and category
// first (same material_category is a strong signal), then name
// similarity, then thickness proximity." Implemented as a GATE, not a
// soft-weighted signal, for category+line: a candidate is only
// considered at all when it shares the row's category AND has at least
// one word in common with the row's parsed line. Category alone was
// deliberately rejected as a sufficient signal -- an org can have
// dozens of materials in the same category (e.g. "Acrylic"), and
// suggesting all of them because they share a category with zero name
// overlap would be exactly the noise the instruction warns against
// ("a bad suggestion he trusts is worse than no suggestion"). Within
// that gate, name similarity is the primary ranking driver and
// thickness match is a smaller tiebreaker bonus, matching the stated
// priority order.

export type ParentCandidate = {
  id: string
  name: string
  categoryId: string | null
}

export type ParentSuggestion = {
  materialId: string
  materialName: string
  score: number
  reason: string
}

function normWords(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean))
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const w of a) if (b.has(w)) overlap++
  return (2 * overlap) / (a.size + b.size)
}

// Approximates a candidate material's own (line, axisValue) split from
// its plain name text, using the same axis-start detector the
// substrate parser uses. Candidate materials don't carry pre-parsed
// line/axisValue (unlike a FamilyProposal) -- this is a best-effort
// re-derivation for ranking purposes only, not used for any write.
function splitCandidateName(name: string, findAxisStart: (s: string) => number): { line: string; axisValue: string | null } {
  const idx = findAxisStart(name)
  if (idx === -1) return { line: name.trim(), axisValue: null }
  return { line: name.slice(0, idx).trim(), axisValue: name.slice(idx).trim() }
}

const MAX_SUGGESTIONS = 5

export function suggestParentMaterials(
  row: { line: string; axisValue: string | null; categoryId: string | null; categoryName: string | null },
  candidates: ParentCandidate[],
  findAxisStart: (s: string) => number,
): ParentSuggestion[] {
  if (!row.categoryId) return [] // no resolved category on the row at all -- no reliable signal, "no likely parent" rather than a guess

  const rowWords = normWords(row.line)
  if (rowWords.size === 0) return []

  const scored: ParentSuggestion[] = []
  for (const c of candidates) {
    if (c.categoryId !== row.categoryId) continue // hard gate -- see header comment

    const { line: candLine, axisValue: candAxis } = splitCandidateName(c.name, findAxisStart)
    const sim = diceCoefficient(rowWords, normWords(candLine))
    if (sim <= 0) continue // gate: category alone is never enough

    const thicknessMatch = !!(row.axisValue && candAxis && row.axisValue.trim().toLowerCase() === candAxis.trim().toLowerCase())
    const score = sim * 3 + (thicknessMatch ? 1 : 0) // name similarity is the primary driver within the gate; thickness is a smaller tiebreaker, per instruction

    const reasonParts = [`same category${row.categoryName ? ` (${row.categoryName})` : ''}`]
    reasonParts.push(sim >= 0.8 ? `name closely matches ("${candLine}")` : `name overlaps ("${candLine}")`)
    if (thicknessMatch) reasonParts.push(`same thickness (${row.axisValue})`)

    scored.push({ materialId: c.id, materialName: c.name, score, reason: reasonParts.join(' · ') })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_SUGGESTIONS)
}

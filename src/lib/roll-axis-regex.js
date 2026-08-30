// Roll/vinyl identity-axis matcher — split into its own plain-JS module
// (not inlined in material-family-proposals.ts) for exactly one reason:
// it needs to be importable, unmodified, by both the real TS parser AND
// a plain `node` test script with zero build step and zero new
// dependencies (this repo has no test runner) — see
// scripts/verify-roll-axis-regex.mjs. TypeScript's `allowJs` (tsconfig)
// already lets .ts files import a plain .js file like this one with an
// explicit extension, so this costs nothing on the app side.
//
// Confirmed live over all 368 NEW "Roll Materials" rows (org
// 4ca12dff-97be-4472-8099-ab102a3af01a, 2026-08-22): weight (oz) and
// thickness (Mil) are two mutually exclusive naming conventions — 48
// rows use oz, 224 use Mil, ZERO rows use both. See
// known-issues/2026-08-22-roll-vinyl-migrate-pass-proposal.md item (a).
//
// CRITICAL, per instruction: "Mil" (thickness, thousandths of an inch)
// must never match "ML" (millilitres — ink material names carry tokens
// like "700ML"). This isn't just "unlikely to collide" — the literal
// substring "mil" requires an "i" between the m and the l; "ML"/"ml" has
// no "i" at all, so the word-bounded literal match below cannot match it
// structurally, by the shape of the two words, not by luck. Proven in
// scripts/verify-roll-axis-regex.mjs (run: `node
// scripts/verify-roll-axis-regex.mjs`).
export const ROLL_AXIS_RE = /(\d+(?:\.\d+)?)\s*(oz|mil)\b/i

// Returns the [start, end) character span of the FIRST axis token found
// in `text` (e.g. "3.5Mil", "19.5oz"), or null if none is found. A span,
// not just a start index, because rolls need to know where the axis
// token ENDS too — text after it is the brand/product-line marker
// (Oracal 651, Avery SW900, 3M 180C), a separate, family-distinguishing
// field. Substrates never needed this (their axis is "everything from
// the start to the end of the string").
export function findRollAxisSpan(text) {
  const m = ROLL_AXIS_RE.exec(text)
  if (!m || m.index === undefined) return null
  return { start: m.index, end: m.index + m[0].length }
}

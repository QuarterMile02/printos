// Permanent regression proof, not a scratch script — keep this. Plain
// `node`, zero flags, zero build step, zero new dependencies (this repo
// has no test runner). Run: `node scripts/verify-roll-axis-regex.mjs`.
//
// Proves the one thing explicitly required before ROLL_FAMILY_CONFIG
// could ship: "Mil" (thickness) must never match "ML" (millilitres —
// ink material names carry tokens like "700ML"). Imports the ACTUAL
// regex from src/lib/roll-axis-regex.js (not a copy) — this test rots
// the moment that file's behavior changes, on purpose.
import { ROLL_AXIS_RE, findRollAxisSpan } from '../src/lib/roll-axis-regex.js'

let failures = 0
function check(desc, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (!pass) {
    failures++
    console.error(`FAIL: ${desc}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`)
  } else {
    console.log(`ok — ${desc}`)
  }
}

// ── The critical case: Mil must never match ML ─────────────────────
check('bare "700ML" (ink volume) does not match', ROLL_AXIS_RE.test('700ML'), false)
check('bare "700ml" lowercase does not match', ROLL_AXIS_RE.test('700ml'), false)
check('real-shaped ink name never matches', ROLL_AXIS_RE.test('UV Ink Cyan 700ML'), false)
check('"5ML" (small volume) does not match', ROLL_AXIS_RE.test('Cleaning Solution 5ML'), false)
check('findRollAxisSpan returns null for an ML-only name', findRollAxisSpan('UV Ink Cyan 700ML'), null)

// ── True positives: real Roll Materials axis tokens must still match ─
check('"3.5Mil" matches', ROLL_AXIS_RE.test('3.5Mil'), true)
check('"2Mil" matches', ROLL_AXIS_RE.test('2Mil'), true)
check('"19.5oz" matches', ROLL_AXIS_RE.test('19.5oz'), true)
check('"13oz" matches', ROLL_AXIS_RE.test('13oz'), true)
check(
  'findRollAxisSpan finds the right span in a real roll name',
  findRollAxisSpan('Vinyl White (180C) 2Mil Avery UC900'),
  { start: 19, end: 23 },
)

// ── A name that happens to carry BOTH a real Mil token and an
// unrelated ML-shaped substring must still only match the Mil token,
// not get confused ──────────────────────────────────────────────────
check(
  'a name with "Mil" AND an unrelated "ML" nearby matches only the Mil span',
  findRollAxisSpan('Vinyl 3Mil HELMLEY Series'),
  { start: 6, end: 10 }, // "3Mil" — the "ML" inside "HELMLEY" is not preceded by digits, cannot match on its own
)

// ── Word-boundary edge cases: must not match mid-word ────────────────
check('"Milk" does not match (word boundary)', ROLL_AXIS_RE.test('5 Milk'), false)
check('"Military" does not match (word boundary)', ROLL_AXIS_RE.test('5 Military'), false)

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')

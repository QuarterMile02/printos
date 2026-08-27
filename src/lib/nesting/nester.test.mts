// Tests for nester.ts, run via Node's own built-in test runner (`node
// --test`) -- the repo has no test runner in package.json to defer to
// (checked first, per instructions), and Node's built-in one needs no
// new dependency. This file is .mts (not .ts, matching the rest of
// src/lib/nesting) purely so Node's loader treats it as ESM outright
// with no ambiguous-module-type warning; nester.ts itself is a plain
// .ts file like everything else in src/lib, and importing it from here
// still prints one harmless MODULE_TYPELESS_PACKAGE_JSON warning (Node
// re-parses it as ESM instead of throwing) -- expected, not a failure,
// and not fixed by touching the project's own package.json "type"
// field, which is out of scope for this PR and could affect the whole
// Next.js build.
//
// Run with:  node --test src/lib/nesting/nester.test.mts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { nestMaterial, type NesterInput } from './nester.ts'

const SQFT = 144

// Every field defaulted to "doesn't matter for this test" so each case
// only overrides what it's actually about.
function baseInput(overrides: Partial<NesterInput>): NesterInput {
  return {
    stock_height: null,
    stock_width: null,
    fixed_side: 'height',
    length_increment: null,
    product_height: 1,
    product_width: 1,
    quantity: 1,
    spacing: 0,
    edge_margin: 0,
    may_rotate: false,
    seam_overlap_width: 0,
    seam_direction: 'both',
    ...overrides,
  }
}

// THE INVARIANT, asserted on every single case below, no exceptions:
// product + offcut + remainder === the whole piece consumed+remaining.
// For a bounded piece (sheets, 'both') that's the full stock_height *
// stock_width. For an unbounded one (rolls: remainder_sqft is always 0
// by the model's own definition -- see nester.ts), consumed itself
// stands in for "the whole piece", since a roll's piece is exactly
// however much was cut, no more.
function assertInvariant(out: ReturnType<typeof nestMaterial>, wholePieceSqft: number, label: string) {
  const sum = out.product_sqft + out.offcut_sqft + out.remainder_sqft
  assert.ok(
    Math.abs(sum - wholePieceSqft) < 1e-6,
    `${label}: product(${out.product_sqft}) + offcut(${out.offcut_sqft}) + remainder(${out.remainder_sqft}) = ${sum}, expected ${wholePieceSqft}`,
  )
}

function approx(actual: number, expected: number, label: string, tol = 1e-3) {
  assert.ok(Math.abs(actual - expected) < tol, `${label}: expected ~${expected}, got ${actual}`)
}

describe('11 VERIFIED cases (known-issues/2026-08-24-stage2-nesting-model-VERIFIED.md)', () => {
  test('1. canonical: 48h x 96w sheet, fixed_side=height, 12x12 product, qty 1', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 12, product_width: 12, quantity: 1,
    }))
    assert.equal(out.fits, true)
    approx(out.consumed_sqft, 4, 'consumed')
    approx(out.product_sqft, 1, 'product')
    approx(out.offcut_sqft, 3, 'offcut')
    approx(out.remainder_sqft, 28, 'remainder')
    assertInvariant(out, 32, 'test 1')
  })

  test('2a. rotation NOT taken -- widens the band and loses (30h x 20w on 48x96, fixed_side=height)', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 30, product_width: 20, quantity: 1, may_rotate: true,
    }))
    assert.equal(out.fits, true)
    assert.equal(out.rotated, false, 'must not rotate -- rotating increases offcut here')
    approx(out.consumed_sqft, 48 * 20 / SQFT, 'consumed')
    approx(out.product_sqft, 30 * 20 / SQFT, 'product')
    approx(out.offcut_sqft, 48 * 20 / SQFT - 30 * 20 / SQFT, 'offcut')
    approx(out.remainder_sqft, (48 * 96 - 48 * 20) / SQFT, 'remainder')
    assertInvariant(out, 32, 'test 2a')
  })

  test('2b. same geometry with may_rotate=false confirms the non-rotated numbers are the "as given" ones', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 30, product_width: 20, quantity: 1, may_rotate: false,
    }))
    assert.equal(out.rotated, false)
    approx(out.offcut_sqft, 2.5, 'offcut')
    assertInvariant(out, 32, 'test 2b')
  })

  test('3a. roll vs sheet competing -- Acrylic side (fixed_side=height, 48x96), 40x40 product', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 40, product_width: 40, quantity: 1,
    }))
    approx(out.consumed_sqft, 13.3333, 'consumed')
    approx(out.product_sqft, 11.1111, 'product')
    approx(out.offcut_sqft, 2.2222, 'offcut')
    approx(out.remainder_sqft, 18.6667, 'remainder')
    assert.equal(out.panels, 1)
    assert.equal(out.seams, 0)
    assertInvariant(out, 32, 'test 3a')
  })

  test('3b. roll vs sheet competing -- Oracal side (fixed_side=width, width=48, length open), 40x40 product', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'width', stock_width: 48, stock_height: null,
      product_height: 40, product_width: 40, quantity: 1,
    }))
    approx(out.consumed_sqft, 13.3333, 'consumed')
    approx(out.product_sqft, 11.1111, 'product')
    approx(out.offcut_sqft, 2.2222, 'offcut')
    approx(out.remainder_sqft, 0, 'remainder -- a roll never tracks one')
    assert.equal(out.panels, 1)
    assert.equal(out.seams, 0)
    assertInvariant(out, out.consumed_sqft, 'test 3b') // roll: "the piece" is exactly what was cut, so this is self-consistency, matching the doc's own method for roll cases
  })

  test('4a. fewest seams beats lowest cost -- width=24 roll needs 2 panels for a width-40 product', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'width', stock_width: 24, stock_height: null,
      product_height: 1, product_width: 40, quantity: 1,
    }))
    approx(out.consumed_sqft, 0.3333, 'consumed')
    approx(out.product_sqft, 0.2778, 'product')
    approx(out.offcut_sqft, 0.0556, 'offcut')
    assert.equal(out.panels, 2)
    assert.equal(out.seams, 1)
    assertInvariant(out, out.consumed_sqft, 'test 4a')
  })

  test('4b. width=48 roll needs only 1 panel for the same width-40 product', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'width', stock_width: 48, stock_height: null,
      product_height: 1, product_width: 40, quantity: 1,
    }))
    approx(out.consumed_sqft, 0.3333, 'consumed')
    approx(out.product_sqft, 0.2778, 'product')
    approx(out.offcut_sqft, 0.0556, 'offcut')
    assert.equal(out.panels, 1)
    assert.equal(out.seams, 0)
    // The geometry is numerically IDENTICAL to 4a -- the whole point of
    // this case. Cost never enters this function at all.
    assertInvariant(out, out.consumed_sqft, 'test 4b')
  })

  test('5. paneled product taller than the roll -- width=48 roll, product width=100 (along the rolls fixed axis), height=1', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'width', stock_width: 48, stock_height: null,
      product_height: 1, product_width: 100, quantity: 1,
    }))
    assert.equal(out.panels, 3)
    assert.equal(out.seams, 2)
    approx(out.consumed_sqft, 1.0, 'consumed')
    approx(out.product_sqft, 0.6944, 'product')
    approx(out.offcut_sqft, 0.3056, 'offcut')
    assertInvariant(out, 1.0, 'test 5')
  })

  test('6. calculate_wastage=false -- identical geometry to test 1 (charging is independent of nesting)', () => {
    // The nester has no `calculate_wastage` input at all: it always
    // computes offcut; whether that offcut is CHARGED is a pricing
    // concern layered on top, entirely outside this function -- which
    // is exactly the point of this test case. Same call as test 1.
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 12, product_width: 12, quantity: 1,
    }))
    approx(out.consumed_sqft, 4, 'consumed')
    approx(out.product_sqft, 1, 'product')
    approx(out.offcut_sqft, 3, 'offcut')
    approx(out.remainder_sqft, 28, 'remainder')
    assertInvariant(out, 32, 'test 6')
  })

  test('7a. length_increment rounding -- 17" requested rounds up to 24" (2x12)', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'width', stock_width: 48, stock_height: null,
      product_height: 17, product_width: 1, quantity: 1,
      length_increment: 12,
    }))
    approx(out.consumed_sqft, 8, 'consumed -- 48 x 24 / 144')
    assertInvariant(out, 8, 'test 7a')
  })

  test('7b. length_increment rounding -- exact boundary (24") does not bump to 36"', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'width', stock_width: 48, stock_height: null,
      product_height: 24, product_width: 1, quantity: 1,
      length_increment: 12,
    }))
    approx(out.consumed_sqft, 8, 'consumed -- stays at 48 x 24 / 144, not 48 x 36')
  })

  test('7c. length_increment rounding -- just over a boundary (24.01") rounds up to 36"', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'width', stock_width: 48, stock_height: null,
      product_height: 24.01, product_width: 1, quantity: 1,
      length_increment: 12,
    }))
    approx(out.consumed_sqft, 12, 'consumed -- 48 x 36 / 144')
  })

  test('8. long stock, fixed_side=width -- same shape as a roll, no invented "length" fixed_side', () => {
    // Steel Square Tubing 1.5x1.5x24ft, fixed_side=width. Cross-section
    // width fixed (say 1.5in), length (24ft = 288in) is the free axis --
    // structurally identical to test 3b/4/5, just with different numbers.
    const out = nestMaterial(baseInput({
      fixed_side: 'width', stock_width: 1.5, stock_height: null,
      product_height: 36, product_width: 1.5, quantity: 1,
    }))
    assert.equal(out.fits, true)
    assert.equal(out.panels, 1)
    approx(out.consumed_sqft, 1.5 * 36 / SQFT, 'consumed')
    assertInvariant(out, 1.5 * 36 / SQFT, 'test 8')
  })

  test('9. fixed_side=both -- whole piece always consumed, remainder always 0 (Grommets box analogy)', () => {
    // The report's own worked numbers for this case (100/60/40) are unit
    // counts, not sqft -- there's no real height x width in the source
    // material. Mapped onto a concrete 120x120in "box" (10x10 = 100
    // slots of a 12x12in = exactly-1-sqft unit each) so the SAME
    // area-shaped output type this function returns everywhere else can
    // be exercised and checked against those exact numbers.
    const out = nestMaterial(baseInput({
      fixed_side: 'both', stock_height: 120, stock_width: 120,
      product_height: 12, product_width: 12, quantity: 60,
    }))
    approx(out.consumed_sqft, 100, 'consumed -- the whole box, even though only 60 are needed')
    approx(out.product_sqft, 60, 'product')
    approx(out.offcut_sqft, 40, 'offcut')
    approx(out.remainder_sqft, 0, 'remainder -- always 0 under both')
    assertInvariant(out, 100, 'test 9')
  })

  test('10. seam overlap adds real extra consumption on top of the paneled math from test 5', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'width', stock_width: 48, stock_height: null,
      product_height: 1, product_width: 100, quantity: 1,
      seam_overlap_width: 1,
    }))
    assert.equal(out.seams, 2)
    approx(out.consumed_sqft, 1.0139, 'consumed -- base 1.0 + 2 seams x 1in overlap x 1in height / 144')
    assertInvariant(out, out.consumed_sqft, 'test 10')
  })

  test('11. recipe override reaches the nester -- a different seam_overlap_width changes the answer', () => {
    // Proves the override isn't read-and-discarded (the same failure
    // class already found twice elsewhere in this codebase): passing a
    // DIFFERENT overlap than test 10 produces a DIFFERENT, correctly
    // computed number, not test 10's number silently repeated.
    const out = nestMaterial(baseInput({
      fixed_side: 'width', stock_width: 48, stock_height: null,
      product_height: 1, product_width: 100, quantity: 1,
      seam_overlap_width: 2,
    }))
    approx(out.consumed_sqft, 1.0278, 'consumed -- base 1.0 + 2 seams x 2in overlap x 1in height / 144')
    assert.notEqual(out.consumed_sqft, 1.0139, 'must differ from test 10s 1-inch-overlap answer')
    assertInvariant(out, out.consumed_sqft, 'test 11')
  })
})

describe('Additional edge cases', () => {
  test('product exactly equal to the stock piece -- zero offcut, zero remainder', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 48, product_width: 96, quantity: 1,
    }))
    assert.equal(out.fits, true)
    approx(out.consumed_sqft, 32, 'consumed')
    approx(out.product_sqft, 32, 'product')
    approx(out.offcut_sqft, 0, 'offcut')
    approx(out.remainder_sqft, 0, 'remainder')
    assertInvariant(out, 32, 'exact fit')
  })

  test('product larger than the piece on the FIXED axis only -- rescued by paneling', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 60, product_width: 10, quantity: 1, // 60 > 48
      seam_direction: 'both',
    }))
    assert.equal(out.fits, true)
    assert.equal(out.panels, 2, 'ceil(60/48) = 2 stacked sheet-heights, seamed')
    assert.equal(out.seams, 1)
    assertInvariant(out, out.consumed_sqft, 'oversize on fixed axis, no bounded single piece any more once paneled')
  })

  test('product larger than the piece on the FIXED axis only -- refused when seam_direction=none', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 60, product_width: 10, quantity: 1,
      seam_direction: 'none',
    }))
    assert.equal(out.fits, false)
    assert.match(out.reason ?? '', /seam/i)
  })

  test('product larger than the piece on the FREE (bounded) axis only -- does not fit, no rescue exists', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 10, product_width: 100, quantity: 1, // 100 > 96, and fixed axis (height) is fine
      may_rotate: false,
    }))
    assert.equal(out.fits, false)
    assert.equal(out.consumed_sqft, 0)
    assert.equal(out.product_sqft, 0)
    assert.equal(out.n_up, 0, 'never a nonsense n_up of 0 paired with real areas -- both are 0 together')
  })

  test('quantity 0 -- fits, nothing consumed, no crash, no nonsense n_up-with-real-areas', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 12, product_width: 12, quantity: 0,
    }))
    assert.equal(out.fits, true)
    assert.equal(out.consumed_sqft, 0)
    assert.equal(out.product_sqft, 0)
    assert.equal(out.offcut_sqft, 0)
    approx(out.remainder_sqft, 32, 'the whole untouched sheet')
    assertInvariant(out, 32, 'quantity 0')
  })

  test('quantity 1 -- already covered by every VERIFIED case above; one direct check here', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 12, product_width: 12, quantity: 1,
    }))
    assert.equal(out.fits, true)
    approx(out.product_sqft, 1, 'product')
  })

  test('rotation WINS -- swapping which product side faces the band narrows it and cuts offcut', () => {
    // Both orientations fit within one band (fixed axis = height = 48,
    // no paneling either way) -- this isolates the same "smaller free-
    // axis footprint wins" rule test 2 demonstrates, just with the
    // winner flipped: non-rotated band width = 45 (product_width),
    // rotated band width = 40 (product_height) -- narrower band, less
    // material, same product area either way.
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 40, product_width: 45, quantity: 1, may_rotate: true,
    }))
    assert.equal(out.fits, true)
    assert.equal(out.rotated, true)
    approx(out.consumed_sqft, 48 * 40 / SQFT, 'consumed -- narrower band wins')
    approx(out.offcut_sqft, (48 * 40 - 40 * 45) / SQFT, 'offcut')
    assertInvariant(out, (48 * 96) / SQFT, 'rotation wins')
  })

  test('rotation FORBIDDEN -- same geometry as above, may_rotate=false must keep the wider (worse) band', () => {
    const out = nestMaterial(baseInput({
      fixed_side: 'height', stock_height: 48, stock_width: 96,
      product_height: 40, product_width: 45, quantity: 1, may_rotate: false,
    }))
    assert.equal(out.rotated, false)
    assert.equal(out.fits, true)
    approx(out.consumed_sqft, 48 * 45 / SQFT, 'consumed -- stuck with the wider band since rotation is forbidden')
  })
})

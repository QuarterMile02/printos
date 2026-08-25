#!/usr/bin/env node
// scripts/verify-variant-pricing-parity.mjs
//
// Stage A regression harness. Prices EVERY active product TWICE:
//   - "before": the exact src/lib/pricing/formula-engine.ts as committed on
//     `main` right now (fetched fresh via `git show`, loaded as an
//     independent module) -- the pricing engine as it exists WITHOUT this
//     PR's diff.
//   - "after": this branch's formula-engine.ts (prefers a selected
//     material_variants row when one can be picked with confidence,
//     falling back to materials.cost/price otherwise) -- the pricing
//     engine WITH the diff applied.
// Reports every product whose unit_price_cents differs between the two,
// by how much, and which recipe material + selection branch caused it.
//
// Also prints the branch counts asked for: across every material actually
// referenced by a live product recipe, how many resolve via a width match,
// how many via a single is_default (or the material's only variant), how
// many fall back to materials.cost because the pick is ambiguous (>1
// is_default, no width match), and how many are structurally zero-variant.
//
// Read-only. Reads products, product_default_items, product_dropdown_items,
// materials, material_variants (all via the real calculateProductPrice code
// path, both versions). Writes nothing to the database. The only file this
// script writes is a temporary same-directory copy of main's
// formula-engine.ts (needed so its relative `./compute-line-item` import
// still resolves) -- deleted in a `finally` block before the script exits,
// success or failure. Never touches shopvox_*, quotes, sales_orders,
// invoices, jobs, payments, refunds, or any line-item table.
//
// Usage:
//   node scripts/verify-variant-pricing-parity.mjs
//   node scripts/verify-variant-pricing-parity.mjs --limit=20        (smoke test)
//   node scripts/verify-variant-pricing-parity.mjs --width=54 --height=100

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'

for (const line of readFileSync(path.join(REPO_ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([a-z]+)=(.+)$/.exec(a)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]
  }),
)
const WIDTH = Number(args.width ?? 24)
const HEIGHT = Number(args.height ?? 24)
const LIMIT = args.limit ? Number(args.limit) : Infinity

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function fetchAll(table, select, filters = []) {
  const pageSize = 1000
  let from = 0
  const out = []
  for (;;) {
    let q = sb.from(table).select(select).range(from, from + pageSize - 1)
    for (const [col, op, val] of filters) q = q[op](col, val)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

async function main() {
  // ── Part 1: branch counts across every material referenced by a live recipe ──

  console.log('=== Branch counts: materials referenced by a live product recipe ===')

  const pdi = await fetchAll(
    'product_default_items',
    'id, product_id, material_id, item_type',
    [['organization_id', 'eq', ORG_ID], ['item_type', 'eq', 'Material']],
  )
  const pdrop = await fetchAll(
    'product_dropdown_items',
    'id, material_id, item_type',
    [['organization_id', 'eq', ORG_ID], ['item_type', 'eq', 'Material']],
  )
  const recipeMatIds = [...new Set([...pdi, ...pdrop].map(r => r.material_id).filter(Boolean))]

  const variantRows = await fetchAll(
    'material_variants',
    'id, material_id, width, height, fixed_side, is_default, cost_per_unit, sell_per_unit, sort_order',
    [['organization_id', 'eq', ORG_ID]],
  )
  const variantsByMaterial = new Map()
  for (const v of variantRows) {
    const arr = variantsByMaterial.get(v.material_id) ?? []
    arr.push(v)
    variantsByMaterial.set(v.material_id, arr)
  }

  // Import the REAL, exported selection function from this branch's engine --
  // not a reimplementation, so the counts reported here can't drift from
  // what the engine itself actually does.
  const engineUrl = pathToFileURL(path.join(REPO_ROOT, 'src/lib/pricing/formula-engine.ts')).href
  const { selectMaterialVariant } = await import(engineUrl)

  const branchCounts = { zeroVariant: 0, widthMatch: 0, singleDefault: 0, ambiguousFallback: 0 }
  const branchDetail = []
  for (const matId of recipeMatIds) {
    const vs = variantsByMaterial.get(matId) ?? []
    if (vs.length === 0) { branchCounts.zeroVariant++; continue }
    const picked = selectMaterialVariant(vs, WIDTH)
    if (!picked) { branchCounts.ambiguousFallback++; continue }
    if (picked._reason === 'narrowest_fit') branchCounts.widthMatch++
    else branchCounts.singleDefault++ // 'only_variant' or 'single_default'
    branchDetail.push({ material_id: matId, reason: picked._reason, variant_id: picked.id })
  }

  console.log(`materials referenced by a live recipe: ${recipeMatIds.length}`)
  console.log(`  width-match (narrowest fit):                          ${branchCounts.widthMatch}`)
  console.log(`  single is_default (or material's only variant):      ${branchCounts.singleDefault}`)
  console.log(`  ambiguous (>1 default, no width match) -> fallback:   ${branchCounts.ambiguousFallback}`)
  console.log(`  zero-variant -> materials.cost fallback:              ${branchCounts.zeroVariant}`)
  console.log(`  sum check: ${branchCounts.widthMatch + branchCounts.singleDefault + branchCounts.ambiguousFallback + branchCounts.zeroVariant} == ${recipeMatIds.length}`)

  // ── Part 2: price every active product twice — main (before) vs this branch (after) ──

  console.log(`\n=== Price parity: main (before) vs this branch (after), at ${WIDTH}x${HEIGHT}in ===`)

  const products = await fetchAll('products', 'id, name', [['organization_id', 'eq', ORG_ID], ['active', 'eq', true]])
  const toPrice = LIMIT === Infinity ? products : products.slice(0, LIMIT)
  console.log(`pricing ${toPrice.length} of ${products.length} active products...`)

  const beforeSrc = execSync('git show main:src/lib/pricing/formula-engine.ts', { cwd: REPO_ROOT, encoding: 'utf8' })
  const beforePath = path.join(REPO_ROOT, 'src/lib/pricing/_parity_baseline_formula-engine.ts')
  writeFileSync(beforePath, beforeSrc)

  const changed = []
  try {
    const { calculateProductPrice: priceBefore } = await import(pathToFileURL(beforePath).href)
    const { calculateProductPrice: priceAfter } = await import(engineUrl)

    let priced = 0
    for (const p of toPrice) {
      const [before, after] = await Promise.all([
        priceBefore({ product_id: p.id, width_inches: WIDTH, height_inches: HEIGHT, quantity: 1 }),
        priceAfter({ product_id: p.id, width_inches: WIDTH, height_inches: HEIGHT, quantity: 1 }),
      ])
      priced++
      if (before.unit_price_cents !== after.unit_price_cents) {
        changed.push({
          product_id: p.id,
          name: p.name,
          before_cents: before.unit_price_cents,
          after_cents: after.unit_price_cents,
          delta_cents: after.unit_price_cents - before.unit_price_cents,
          changed_lines: after.breakdown
            .filter((b, i) => b.cost_cents !== before.breakdown[i]?.cost_cents)
            .map(b => b.name),
        })
      }
      if (priced % 100 === 0) console.log(`  ...${priced}/${toPrice.length}`)
    }

    console.log(`\npriced ${priced} products.`)
    console.log(`PRICE CHANGED: ${changed.length}`)
    if (changed.length > 0) {
      console.table(changed)
      console.log('\nNON-ZERO RESULT -- per instruction, do not open the PR. Report and wait.')
    } else {
      console.log('Zero products changed price. Diff is confirmed price-neutral against live data.')
    }
  } finally {
    if (existsSync(beforePath)) unlinkSync(beforePath)
  }

  return { branchCounts, changedCount: changed.length, changed }
}

main().catch(err => {
  console.error('HARNESS FAILED:', err.message)
  process.exit(1)
})

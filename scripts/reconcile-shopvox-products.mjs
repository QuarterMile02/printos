// Fresh products reconciliation: ShopVOX's live full product catalog vs.
// PrintOS's current products table, compared by exact (case-insensitive,
// trimmed) name match. Reports ShopVOX products with no PrintOS match.
//
// READ-ONLY. No DB writes, no ShopVOX writes, no material/product creation.
// This deliberately does NOT read or reconcile against any prior partial
// list -- it's a from-scratch comparison against live data on both sides.
//
// Reuses the exact same ShopVOX product-discovery method already proven
// live in shopvox-extract.mjs (fetchAllProductsViaApi): a direct call to
// ShopVOX's own product API (api.shopvox.com/edge/products) using the
// browser's authenticated session cookies + the 'x-shopvox-client: web'
// header cookies alone aren't enough for (confirmed there, not re-derived
// here). Active and inactive products are separate filtered queries --
// an unfiltered request silently excludes disabled products -- so both
// are fetched and merged by id, same as the proven original.
//
// Usage:
//   node scripts/reconcile-shopvox-products.mjs
//   node scripts/reconcile-shopvox-products.mjs --cdp=http://localhost:9222

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const argv = process.argv.slice(2)
function getFlag(name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  return eq ? eq.slice(name.length + 1) : null
}
const CDP_URL = getFlag('--cdp')

// ── .env.local — same loader as shopvox-extract.mjs ────────────────────
const envText = readFileSync(resolve(repoRoot, '.env.local'), 'utf8')
const env = {}
for (const raw of envText.split(/\r?\n/)) {
  const line = raw.trim()
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq === -1) continue
  const k = line.slice(0, eq).trim()
  let v = line.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[k] = v
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const SESSION_DIR = resolve(__dirname, '.shopvox-session') // shared with shopvox-extract.mjs / scrape-shopvox-material-tiers.js
const OUTPUT_FILE = resolve(__dirname, 'shopvox-products-reconciliation-report.json')

const URLS = { base: 'https://express.shopvox.com', products: 'https://express.shopvox.com/settings/products' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Same 1000-row-truncation guard used throughout tonight's work.
const PAGE_SIZE = 1000
async function fetchAllRows(build) {
  const all = []
  let from = 0
  for (;;) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

async function launchBrowser() {
  if (CDP_URL) {
    console.log(`Connecting to Chrome via CDP: ${CDP_URL}`)
    const browser = await chromium.connectOverCDP(CDP_URL)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    return { context }
  }
  for (const lock of ['SingletonLock', 'lockfile', 'Default/LOCK']) {
    const lockPath = resolve(SESSION_DIR, lock)
    if (existsSync(lockPath)) { try { unlinkSync(lockPath) } catch {} }
  }
  console.log(`Launching persistent Chromium (session: ${SESSION_DIR})`)
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false, channel: 'chromium', viewport: { width: 1440, height: 900 },
  })
  return { context }
}

// Same lightweight pre-check pattern as scrape-shopvox-material-tiers.js's
// --create-uuids mode: only fall into the interactive "press ENTER" wait
// if genuinely signed out.
async function ensureLoggedIn(page) {
  await page.goto(URLS.products, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {})
  if (!/\/sign-in/i.test(page.url())) return

  console.log('\n────────────────────────────────────────────────────────')
  console.log('  MANUAL STEP — in the open Chromium window:')
  console.log('    1. Log into ShopVOX')
  console.log(`    2. Navigate to ${URLS.products}`)
  console.log('  Then press ENTER here to continue.')
  console.log('────────────────────────────────────────────────────────\n')
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  await new Promise((res) => process.stdin.once('data', () => res()))
  process.stdin.pause()

  await page.goto(URLS.products, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {})
  if (/\/sign-in/i.test(page.url())) {
    console.error(`\n✗ Still on the sign-in page (${page.url()}) — login didn't take.`)
    process.exit(1)
  }
}

// Verbatim copy of the proven method in shopvox-extract.mjs.
async function fetchAllProductsViaApi(page) {
  const HEADERS = { 'x-shopvox-client': 'web', 'accept': 'application/json, text/plain, */*' }
  async function fetchByActive(activeValue) {
    const sorts = encodeURIComponent(JSON.stringify({ by: 'name', direction: 'asc' }))
    const filter = encodeURIComponent(JSON.stringify({ by: 'active', rule: 'equal', value: activeValue }))
    const url = `https://api.shopvox.com/edge/products?page=1&sorts[]=${sorts}&perPage=2000&filters[]=${filter}`
    const result = await page.evaluate(async ({ u, headers }) => {
      const res = await fetch(u, { credentials: 'include', headers })
      const text = await res.text()
      let body
      try { body = JSON.parse(text) } catch { body = null }
      return { status: res.status, body }
    }, { u: url, headers: HEADERS })
    if (result.status !== 200 || !result.body?.products) {
      throw new Error(`ShopVOX product API fetch failed (active=${activeValue}): status ${result.status}`)
    }
    return result.body.products
  }
  const [active, inactive] = await Promise.all([fetchByActive(true), fetchByActive(false)])
  const byId = new Map()
  for (const p of [...active, ...inactive]) byId.set(p.id, { ...p, _active: active.includes(p) })
  console.log(`  API discovery: ${active.length} active + ${inactive.length} inactive = ${byId.size} unique products`)
  return [...byId.values()].map((p) => ({
    shopvoxId: p.id,
    name: p.name,
    active: active.some((a) => a.id === p.id),
    url: `${URLS.base}/settings/products/${p.id}`,
  }))
}

async function main() {
  const { context } = await launchBrowser()
  const page = context.pages()[0] ?? (await context.newPage())

  await ensureLoggedIn(page)

  console.log('\nFetching full ShopVOX product catalog via API…')
  const shopvoxProducts = await fetchAllProductsViaApi(page)

  console.log('Fetching PrintOS products table (paginated)…')
  const printosProducts = await fetchAllRows((from, to) =>
    sb.from('products').select('id, name, active').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)
  )
  console.log(`  PrintOS: ${printosProducts.length} products`)

  const norm = (s) => (s ?? '').toLowerCase().trim()
  const printosByName = new Map()
  for (const p of printosProducts) {
    const k = norm(p.name)
    if (!printosByName.has(k)) printosByName.set(k, p) // first wins; duplicate PrintOS names noted separately below
  }

  const noMatch = shopvoxProducts.filter((s) => !printosByName.has(norm(s.name)))

  // Also worth surfacing, not the primary ask: PrintOS names that appear
  // more than once (would silently mask a ShopVOX match either way).
  const printosNameCounts = new Map()
  for (const p of printosProducts) {
    const k = norm(p.name)
    printosNameCounts.set(k, (printosNameCounts.get(k) ?? 0) + 1)
  }
  const duplicatePrintosNames = [...printosNameCounts.entries()].filter(([, c]) => c > 1).map(([k]) => k)

  const report = {
    generatedAt: new Date().toISOString(),
    shopvoxTotal: shopvoxProducts.length,
    printosTotal: printosProducts.length,
    noPrintosMatch: noMatch.map((s) => ({ name: s.name, shopvoxId: s.shopvoxId, active: s.active, url: s.url })),
    duplicatePrintosNames,
  }
  writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2))

  console.log(`\n=========== RESULT ===========`)
  console.log(`ShopVOX total: ${shopvoxProducts.length}`)
  console.log(`PrintOS total: ${printosProducts.length}`)
  console.log(`ShopVOX products with NO PrintOS name match: ${noMatch.length}`)
  if (duplicatePrintosNames.length) console.log(`(note: ${duplicatePrintosNames.length} PrintOS name(s) appear more than once — see report)`)
  console.log(`Report written to ${OUTPUT_FILE}`)

  await context.close()
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })

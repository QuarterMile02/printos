// ShopVOX customer index — a COUNTING and ID-CAPTURE pass, NOT a data scrape.
//
// Visits list pages only: the customers list, each customer's own
// Transactions grid, and each customer's Jobs sub-tab. Never opens a
// transaction detail page or a job detail page, never reads line items.
// Writes JSON to disk ONLY — no Supabase client is imported in this file,
// so there is no DB-write code path at all.
//
// PURPOSE: this pilot (scripts/pilot-sames.mjs, run earlier tonight) proved
// the field-completeness and per-record rate for ONE customer. This script
// answers the volume question that pilot could not: how many quotes/sales-
// orders/invoices/jobs exist PER CUSTOMER, across the whole account, so the
// real 7-year transaction scrape can be estimated and planned before it's
// built.
//
// REUSED VERBATIM (same mechanics, copied — not imported, since this is a
// separate file and scripts/pilot-sames.mjs / the original scrapers are
// intentionally left untouched) from scripts/pilot-sames.mjs, which itself
// copied them from scripts/shopvox-extract.mjs and
// scripts/scrape-shopvox-material-tiers.js:
//   - launchBrowser(): persistent session dir + stale-lock cleanup + CDP attach
//   - ensureLoggedIn() / ensureLoggedInLazy(): stdin-gated manual login,
//     skipped when the persisted session is already valid
//   - sleep() / screenshot()
//   - waitForRealContent(): real-content gate (not a fixed sleep) — CONFIRMED
//     LIVE necessary in the pilot; a fixed 1500ms wait caught only a loading
//     spinner
//   - waitForLinksToStopGrowing(): growth-polling wait for an async grid
//     fetch to resolve (same principle as discoverMaterials()'s button-vanish
//     fix — a link count that stops growing is the real signal, not a timer)
//   - clickLoadMoreUntilExhausted(): growth-polling "Load More" clicker (same
//     principle — a vanished/re-rendered button is not a completion signal)
//   - per-record try/catch that logs a failure and continues, never aborting
//     the whole run
//
// NOT reused: typeIntoListSearchInput() — this script walks the FULL
// customers list (paged to exhaustion) rather than searching for one
// customer, so the pilot's My-View-scoped search helper doesn't apply here.
// --range filtering (see below) is done by post-filtering the harvested
// list, not by searching.
//
// Usage:
//   node scripts/shopvox-customer-index.mjs                  # all customers
//   node scripts/shopvox-customer-index.mjs --range=A-M       # first-letter filter, for a 2-machine split
//   node scripts/shopvox-customer-index.mjs --limit=5         # cap customers processed (smoke test)
//   node scripts/shopvox-customer-index.mjs --debug           # screenshot every step
//   node scripts/shopvox-customer-index.mjs --refresh-list    # re-walk the customers list even if a cached list exists
//   node scripts/shopvox-customer-index.mjs --cdp=http://localhost:9222
//
// Output (scripts/customer-index/):
//   customers.json / _totals.json / _errors.json / _customer_list_cache.json
//   — each gets a ".{range}" suffix in its filename when --range is passed
//   (e.g. customers.A-M.json), so two machines running complementary ranges
//   can be merged later without one overwriting the other. No suffix when
//   --range is omitted (the plain names in the spec).
// ────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── CLI flags ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
function getFlag(name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = argv.indexOf(name)
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1]
  return null
}
function hasFlag(name) { return argv.includes(name) }

const DEBUG = hasFlag('--debug')
const CDP_URL = getFlag('--cdp')
const LIMIT = getFlag('--limit') ? parseInt(getFlag('--limit')) : null
const REFRESH_LIST = hasFlag('--refresh-list')
const RANGE_RAW = getFlag('--range')
const LIST_ONLY = hasFlag('--list-only') // Phase A only: walk the customers list, write it out, skip all per-customer Phase B visits entirely

function parseRange(rangeStr) {
  if (!rangeStr) return null
  const m = rangeStr.match(/^([A-Za-z])-([A-Za-z])$/)
  if (!m) throw new Error(`Invalid --range value "${rangeStr}" — expected e.g. A-M`)
  return { start: m[1].toUpperCase(), end: m[2].toUpperCase(), label: `${m[1].toUpperCase()}-${m[2].toUpperCase()}` }
}
const RANGE = parseRange(RANGE_RAW)
function inRange(companyName) {
  if (!RANGE) return true
  const first = (companyName || '').trim().toUpperCase()[0] || ''
  return first >= RANGE.start && first <= RANGE.end
}

// ── Files ─────────────────────────────────────────────────────────────
const SESSION_DIR = resolve(__dirname, '.shopvox-session') // shared read-only reuse with pilot-sames.mjs and both original scrapers
const DEBUG_DIR = resolve(__dirname, 'shopvox-debug') // shared debug dir
const OUTPUT_DIR = resolve(__dirname, 'customer-index')
const suffix = RANGE ? `.${RANGE.label}` : ''
const CUSTOMERS_FILE = resolve(OUTPUT_DIR, `customers${suffix}.json`)
const TOTALS_FILE = resolve(OUTPUT_DIR, `_totals${suffix}.json`)
const ERRORS_FILE = resolve(OUTPUT_DIR, `_errors${suffix}.json`)
const LIST_CACHE_FILE = resolve(OUTPUT_DIR, `_customer_list_cache${suffix}.json`)
const LIST_ONLY_FILE = resolve(OUTPUT_DIR, 'customers-list.json') // --list-only output: uuid + company_name only, no suffix (task explicitly names this path)

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true })
if (DEBUG && !existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true })

function loadJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
function saveJson(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2)) }

// ── Helpers copied from scripts/pilot-sames.mjs ─────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function screenshot(page, label) {
  if (!DEBUG) return
  const safe = label.replace(/[^\w-]+/g, '_').slice(0, 80)
  const path = resolve(DEBUG_DIR, `${Date.now()}_${safe}.png`)
  try { await page.screenshot({ path, fullPage: true }) } catch {}
}

async function launchBrowser() {
  if (CDP_URL) {
    console.log(`Connecting to Chrome via CDP: ${CDP_URL}`)
    const browser = await chromium.connectOverCDP(CDP_URL)
    const contexts = browser.contexts()
    const context = contexts[0] ?? (await browser.newContext())
    return { browser, context }
  }
  for (const lock of ['SingletonLock', 'lockfile', 'Default/LOCK']) {
    const lockPath = resolve(SESSION_DIR, lock)
    if (existsSync(lockPath)) {
      try { unlinkSync(lockPath) } catch {}
      console.log(`  Removed stale lock: ${lock}`)
    }
  }
  console.log(`Launching persistent Chromium (session: ${SESSION_DIR})`)
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: 'chromium',
    viewport: { width: 1440, height: 900 },
  })
  return { browser: null, context }
}

const URLS = { base: 'https://express.shopvox.com', customersList: 'https://express.shopvox.com/customers' }

async function ensureLoggedIn(page) {
  console.log('\n────────────────────────────────────────────────────────')
  console.log('  MANUAL STEP — in the open Chromium window:')
  console.log('    1. Log into ShopVOX if not already logged in')
  console.log(`       (session is shared with the other ShopVOX scrapers — already logged in there? you're set)`)
  console.log(`    2. Navigate to ${URLS.customersList}`)
  console.log('  Then press ENTER here to continue.')
  console.log('  (No timeout — the script will wait as long as you need.)')
  console.log('────────────────────────────────────────────────────────\n')
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  await new Promise((res) => process.stdin.once('data', () => res()))
  process.stdin.pause()

  await page.goto(URLS.customersList, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {})
  let confirmedLoggedIn = false
  let consecutiveOk = 0
  for (let i = 0; i < 3; i++) {
    if (/\/sign-in/i.test(page.url())) { consecutiveOk = 0 }
    else { consecutiveOk++; if (consecutiveOk >= 2) { confirmedLoggedIn = true; break } }
    await sleep(5000)
  }
  if (!confirmedLoggedIn) {
    console.error(`\n✗ Still on the sign-in page (${page.url()}) — login didn't take. Log in fully, then re-run.`)
    process.exit(1)
  }
}

async function ensureLoggedInLazy(page) {
  await page.goto(URLS.customersList, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {})
  if (/\/sign-in/i.test(page.url())) {
    console.log('  Not signed in — falling back to the manual login prompt.')
    await ensureLoggedIn(page)
  } else {
    console.log(`  Already signed in (session reused from ${SESSION_DIR}) — skipping the manual prompt.`)
  }
}

async function waitForRealContent(page, { minLinks = 5, timeoutMs = 30000, label = 'page' } = {}) {
  try {
    await page.waitForFunction((min) => {
      const linkCount = document.querySelectorAll('a[href]').length
      const hasSearch = !!document.querySelector('input[type="search"], input[placeholder*="earch" i]')
      return linkCount >= min || hasSearch
    }, minLinks, { timeout: timeoutMs })
    return true
  } catch {
    await screenshot(page, `${label}_no_content_timeout`)
    console.log(`  WARNING: ${label} never showed real content after ${timeoutMs / 1000}s (url: ${page.url()}) — proceeding anyway. Check the screenshot.`)
    return false
  }
}

async function waitForLinksToStopGrowing(page, hrefSubstring, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  let last = -1
  while (Date.now() < deadline) {
    await sleep(1500)
    const count = await page.evaluate((s) => document.querySelectorAll(`a[href*="${s}"]`).length, hrefSubstring)
    if (count > 0 && count === last) return count
    last = count
  }
  return last
}

async function clickLoadMoreUntilExhausted(page, maxClicks = 10, growthTimeoutMs = 30000) {
  let clicks = 0
  for (;;) {
    const btnText = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('*'))
        .find((el) => el.children.length === 0 && /load\s+(more|remaining|\d+)/i.test(el.innerText || ''))
      return btn ? btn.innerText.trim() : null
    })
    if (!btnText) break
    const before = await page.evaluate(() => document.querySelectorAll('a[href]').length)
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('*'))
        .find((el) => el.children.length === 0 && /load\s+(more|remaining|\d+)/i.test(el.innerText || ''))
      btn?.click()
    })
    const deadline = Date.now() + growthTimeoutMs
    let grew = false
    while (Date.now() < deadline) {
      await sleep(1500)
      const after = await page.evaluate(() => document.querySelectorAll('a[href]').length)
      if (after > before) { grew = true; break }
    }
    if (!grew) break
    clicks++
    if (clicks >= maxClicks) break
  }
  return clicks
}

// ── NEW: range-aware "Load More" — same growth-polling loop as
// clickLoadMoreUntilExhausted above, with one addition: after every growth
// check, peek at the last-loaded row's company-name first letter and stop
// early once it's alphabetically past the requested range end. This is a
// pure optimization, not a correctness requirement — it depends on the
// customers list's default view actually being alphabetically sorted
// (CONFIRMED live in the earlier investigation: "4446 records", sorted
// digit/symbol-first then A→Z). If that sort order ever changes, this just
// stops optimizing early and the loop degrades to a full walk — never
// silently drops customers, since the post-harvest inRange() filter is the
// real correctness backstop, not this early-stop check.
async function clickLoadMoreUntilExhaustedOrRangeDone(page, maxClicks = 300, growthTimeoutMs = 30000) {
  const uuidRe = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.source
  let clicks = 0
  for (;;) {
    if (RANGE) {
      const pastEnd = await page.evaluate(({ uuidReSrc, endChar }) => {
        const re = new RegExp(uuidReSrc)
        const links = Array.from(document.querySelectorAll('a[href^="/customers/"]')).filter((a) => re.test(a.getAttribute('href') || ''))
        if (!links.length) return false
        const last = links[links.length - 1]
        const first = (last.innerText || '').trim().toUpperCase()[0] || ''
        return first > endChar
      }, { uuidReSrc: uuidRe, endChar: RANGE.end })
      if (pastEnd) { console.log(`  Range ${RANGE.label}: last loaded row is past "${RANGE.end}" — stopping Load More early.`); break }
    }
    const btnText = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('*'))
        .find((el) => el.children.length === 0 && /load\s+(more|remaining|\d+)/i.test(el.innerText || ''))
      return btn ? btn.innerText.trim() : null
    })
    if (!btnText) break
    const before = await page.evaluate(() => document.querySelectorAll('a[href]').length)
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('*'))
        .find((el) => el.children.length === 0 && /load\s+(more|remaining|\d+)/i.test(el.innerText || ''))
      btn?.click()
    })
    const deadline = Date.now() + growthTimeoutMs
    let grew = false
    while (Date.now() < deadline) {
      await sleep(1500)
      const after = await page.evaluate(() => document.querySelectorAll('a[href]').length)
      if (after > before) { grew = true; break }
    }
    if (!grew) break
    clicks++
    console.log(`  Customers list: Load More batch ${clicks} done ("${btnText}")`)
    if (clicks >= maxClicks) break
  }
  return clicks
}

// Read-only audit of the customers list's currently active filter rule(s),
// per the explicit instruction to check before walking — since applying a
// filter has been confirmed live to persist into the saved view with no
// separate save step (scripts/pilot-sames.mjs history), this function only
// OPENS the panel to read what's already there; it never selects a field,
// sets an operator, or clicks Filter Now/Clear Filter.
async function auditCustomerListFilter(page) {
  await page.evaluate(() => {
    const myView = Array.from(document.querySelectorAll('*')).find((e) => e.children.length <= 2 && /^My View$/i.test((e.innerText || '').trim()))
    const btns = myView?.closest('div')?.querySelectorAll('button, [role="button"]')
    btns?.[2]?.click()
  })
  await sleep(1200)
  const whereText = await page.evaluate(() => {
    const idx = document.body.innerText.lastIndexOf('Where')
    return idx >= 0 ? document.body.innerText.slice(idx, idx + 250) : null
  })
  console.log('  Customers list filter panel (read-only check):')
  console.log('   ', whereText ? whereText.replace(/\n+/g, ' | ') : '(panel did not open — could not verify)')
  // Close without touching anything, in case the panel intercepts clicks.
  await page.keyboard.press('Escape').catch(() => {})
}

// ── Phase A: harvest the full customers list (uuid, company name, other columns) ──
async function harvestCustomerList(page) {
  await page.goto(URLS.customersList, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await waitForRealContent(page, { label: 'customers_list' })
  await auditCustomerListFilter(page)
  await screenshot(page, 'customers_list_before_load')
  await clickLoadMoreUntilExhaustedOrRangeDone(page)
  await screenshot(page, 'customers_list_after_load')

  return page.evaluate(() => {
    const uuidRe = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
    const excludeSubPath = /\/(edit|balance|contacts|jobs|payments|sales-leads|tasks|assets|notes|emails|refunds|shipments)(\/|$)/
    const anchors = Array.from(document.querySelectorAll('a[href^="/customers/"]'))
      .filter((a) => uuidRe.test(a.getAttribute('href') || '') && !excludeSubPath.test(a.getAttribute('href') || ''))
    const seen = new Set()
    const out = []
    for (const a of anchors) {
      const href = a.getAttribute('href')
      const uuid = href.match(uuidRe)[0]
      if (seen.has(uuid)) continue
      seen.add(uuid)
      const companyName = a.innerText.trim()
      const row = a.closest('tr') || a.closest('[role="row"]') || a.closest('div')
      const rowColumns = row ? row.innerText.split('\n').map((s) => s.trim()).filter(Boolean) : []
      out.push({ shopvox_uuid: uuid, company_name: companyName, row_columns: rowColumns })
    }
    return out
  })
}

// ── Phase B, part 1: per-customer transaction count (grid total + counted-by-type) ──
async function countCustomerTransactions(page, customerUrl) {
  await page.goto(customerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await waitForLinksToStopGrowing(page, '/transactions/')
  // Generous ceiling: Sames Auto Arena's pilot (363 transactions) needed
  // ~8 "Load 50 More" batches; 40 covers up to ~2,000 without an
  // artificially low cap silently truncating a genuinely large account.
  await clickLoadMoreUntilExhausted(page, 40)

  return page.evaluate(() => {
    const bodyText = document.body.innerText
    const totalMatch = bodyText.match(/(\d[\d,]*)\s+records?\b/i)
    const gridTotal = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : null

    const uuidRe = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
    const byType = { quotes: new Set(), sales_orders: new Set(), invoices: new Set() }
    for (const a of document.querySelectorAll('a[href*="/transactions/"]')) {
      const href = a.getAttribute('href') || ''
      const m = href.match(uuidRe)
      if (!m) continue
      if (href.includes('/transactions/quotes/')) byType.quotes.add(m[0])
      else if (href.includes('/transactions/sales-orders/')) byType.sales_orders.add(m[0])
      else if (href.includes('/transactions/invoices/')) byType.invoices.add(m[0])
    }
    return {
      transactions_total_grid: gridTotal, // the grid's own displayed "N records" text — per the brief, recorded but NOT trusted alone (the pilot found the Jobs tab badge to be flatly wrong; this grid text hasn't been caught in the same lie, but it's still just one signal)
      quotes_count: byType.quotes.size,
      sales_orders_count: byType.sales_orders.size,
      invoices_count: byType.invoices.size,
    }
  })
}

// ── Phase B, part 2: per-customer job count via the Jobs sub-tab ────────
// CONFIRMED LIVE in the pilot: the Jobs tab BADGE ("(0/3)") is not a usable
// count — the same customer's actual /jobs sub-tab page had 50+ real job
// links. This function deliberately never reads that badge; it counts real
// distinct /jobs/{uuid} links after paging to exhaustion, exactly as
// instructed.
async function countCustomerJobs(page, customerUrl) {
  const jobsUrl = `${customerUrl}/jobs`
  await page.goto(jobsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await waitForLinksToStopGrowing(page, '/jobs/')
  await clickLoadMoreUntilExhausted(page, 40)
  return page.evaluate(() => {
    const uuidRe = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
    const set = new Set()
    for (const a of document.querySelectorAll('a[href^="/jobs/"]')) {
      const m = (a.getAttribute('href') || '').match(uuidRe)
      if (m) set.add(m[0])
    }
    return set.size
  })
}

// ── Totals ────────────────────────────────────────────────────────────
const PILOT_SECONDS_PER_RECORD = 5.5 // measured live in scripts/pilot-sames.mjs's Sames Auto Arena pilot run (mean across quotes/sales_orders/invoices/jobs: 5.7, 5.7, 5.4, 5.5s)

function computeTotals(byUuid) {
  const all = [...byUuid.values()]
  const ok = all.filter((r) => !r.error)
  const errored = all.filter((r) => r.error)
  const sum = (arr) => arr.reduce((a, b) => a + b, 0)

  const grandTotals = {
    quotes: sum(ok.map((r) => r.quotes_count || 0)),
    sales_orders: sum(ok.map((r) => r.sales_orders_count || 0)),
    invoices: sum(ok.map((r) => r.invoices_count || 0)),
    jobs: sum(ok.map((r) => r.jobs_count || 0)),
  }
  const totalRecordsAllTypes = grandTotals.quotes + grandTotals.sales_orders + grandTotals.invoices + grandTotals.jobs
  const meanSecondsPerCustomer = ok.length ? sum(ok.map((r) => r.elapsedSeconds || 0)) / ok.length : null

  const topCustomersByRecordCount = [...ok]
    .map((r) => ({ shopvox_uuid: r.shopvox_uuid, company_name: r.company_name, total: (r.quotes_count || 0) + (r.sales_orders_count || 0) + (r.invoices_count || 0) + (r.jobs_count || 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 25)

  return {
    range: RANGE ? RANGE.label : 'all',
    customersIndexed: all.length,
    customersOk: ok.length,
    customersErrored: errored.length,
    grandTotals,
    totalRecordsAllTypesIndexed: totalRecordsAllTypes,
    meanSecondsPerCustomer,
    projectedFullDetailScrapeHoursAtPilotRate: (totalRecordsAllTypes * PILOT_SECONDS_PER_RECORD) / 3600,
    pilotSecondsPerRecordUsed: PILOT_SECONDS_PER_RECORD,
    topCustomersByRecordCount,
    generatedAt: new Date().toISOString(),
  }
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const runStartedAt = new Date().toISOString()
  const { context } = await launchBrowser()
  const page = context.pages()[0] ?? (await context.newPage())
  page.on('console', (msg) => { if (msg.type() === 'log' && DEBUG) console.log('  BROWSER:', msg.text()) })

  await ensureLoggedInLazy(page)

  // Phase A: full customer list, cached across restarts (separate from the
  // per-customer checkpoint below — re-walking a 4,000+ row list on every
  // restart just to get back to where Phase B left off would waste real time).
  let customerList
  if (!REFRESH_LIST && existsSync(LIST_CACHE_FILE)) {
    customerList = loadJson(LIST_CACHE_FILE, null)
    console.log(`Loaded cached customer list: ${customerList?.length ?? 0} customers (${LIST_CACHE_FILE}). Pass --refresh-list to re-walk.`)
  }
  if (!customerList) {
    console.log('Walking the full customers list…')
    customerList = await harvestCustomerList(page)
    saveJson(LIST_CACHE_FILE, customerList)
    console.log(`Harvested ${customerList.length} customers. Cached to ${LIST_CACHE_FILE}.`)
  }

  let filtered = customerList.filter((c) => inRange(c.company_name))
  if (RANGE) console.log(`--range=${RANGE.label}: ${filtered.length} of ${customerList.length} customers match.`)
  if (LIMIT) filtered = filtered.slice(0, LIMIT)

  if (LIST_ONLY) {
    saveJson(LIST_ONLY_FILE, filtered.map((c) => ({ shopvox_uuid: c.shopvox_uuid, company_name: c.company_name })))
    console.log(`\n--list-only: wrote ${filtered.length} customers (shopvox_uuid + company_name) to ${LIST_ONLY_FILE}. Skipping Phase B entirely.`)
    await context.close()
    return
  }

  // Phase B: checkpointed per-customer counting.
  const existing = loadJson(CUSTOMERS_FILE, [])
  const byUuid = new Map(existing.map((r) => [r.shopvox_uuid, r]))
  const errors = loadJson(ERRORS_FILE, [])
  const alreadyDone = new Set([...byUuid.values()].filter((r) => !r.error).map((r) => r.shopvox_uuid))
  const todo = filtered.filter((c) => !alreadyDone.has(c.shopvox_uuid))
  console.log(`\nCustomers to index: ${filtered.length} total, ${filtered.length - todo.length} already done (resume), ${todo.length} to process.\n`)

  let processed = 0
  for (const cust of todo) {
    const t0 = Date.now()
    const customerUrl = `${URLS.base}/customers/${cust.shopvox_uuid}`
    try {
      const tx = await countCustomerTransactions(page, customerUrl)
      const jobs_count = await countCustomerJobs(page, customerUrl)
      const elapsedSeconds = (Date.now() - t0) / 1000
      const record = {
        shopvox_uuid: cust.shopvox_uuid,
        company_name: cust.company_name,
        row_columns: cust.row_columns,
        transactions_total_grid: tx.transactions_total_grid,
        transactions_total_counted: tx.quotes_count + tx.sales_orders_count + tx.invoices_count,
        quotes_count: tx.quotes_count,
        sales_orders_count: tx.sales_orders_count,
        invoices_count: tx.invoices_count,
        jobs_count,
        elapsedSeconds,
        scraped_at: new Date().toISOString(),
      }
      byUuid.set(cust.shopvox_uuid, record)
      processed++
      console.log(`  [${processed}/${todo.length}] ${cust.company_name} -> Q:${tx.quotes_count} SO:${tx.sales_orders_count} INV:${tx.invoices_count} JOB:${jobs_count} (grid said ${tx.transactions_total_grid}) in ${elapsedSeconds.toFixed(1)}s`)
    } catch (e) {
      const errRecord = { shopvox_uuid: cust.shopvox_uuid, company_name: cust.company_name, error: e instanceof Error ? e.message : String(e), scraped_at: new Date().toISOString() }
      byUuid.set(cust.shopvox_uuid, errRecord)
      errors.push(errRecord)
      processed++
      console.log(`  [${processed}/${todo.length}] ${cust.company_name} -> ERROR: ${errRecord.error} (continuing to next customer)`)
      saveJson(ERRORS_FILE, errors)
    }
    // Checkpoint after EVERY customer, per the brief.
    saveJson(CUSTOMERS_FILE, [...byUuid.values()])
    saveJson(TOTALS_FILE, computeTotals(byUuid))
  }

  const totals = computeTotals(byUuid)
  totals.runStartedAt = runStartedAt
  totals.runEndedAt = new Date().toISOString()
  saveJson(TOTALS_FILE, totals)

  console.log('\n=========== CUSTOMER INDEX RESULT ===========')
  console.log(JSON.stringify(totals, null, 2))
  console.log(`\nOutput written to ${OUTPUT_DIR}`)

  await context.close()
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})

// ONE-CUSTOMER PILOT — Sames Auto Arena — generic transaction extractor.
//
// PURPOSE: this is NOT the production transaction scraper. It is a
// field-completeness + rate-measurement pilot for exactly one customer,
// scoped to answer the architecture questions in the investigation report
// (parent/child chain, URL patterns, date-filter availability, whether a
// customer's transactions are reachable from their detail page or only via
// each entity's global list). Writes JSON to disk ONLY — no Supabase client
// is even imported in this file, so there is no DB-write code path to
// accidentally trigger.
//
// REUSED VERBATIM (same mechanics, same reasoning) from
// scripts/shopvox-extract.mjs and scripts/scrape-shopvox-material-tiers.js —
// see the comments at each site below for what was copied from where:
//   - launchBrowser(): persistent session dir + stale-lock cleanup + CDP attach
//   - ensureLoggedIn(): stdin-gated manual login + 2-consecutive-reads-5s-apart
//     confirmation (the race-condition fix documented in the materials scraper)
//   - sleep() / screenshot()
//   - closeOpenModal(): 5-step escalating dismissal
//   - the ShopVOX custom-grid DOM shape (_tableExcel_/_rowComponent_/
//     _contentCell_) documented and proven in scrape-shopvox-material-tiers.js
//   - growth-polling instead of trusting a button's optimistic disappearance
//     (documented at length in discoverMaterials() — same principle applied
//     to this script's "Load More" handling, see waitForGrowthOrSettle())
//
// DELIBERATE DEVIATIONS (both explained in the header comment above and
// re-flagged at their call sites):
//   1. Login-wait is CONDITIONAL (check signed-in state first, only block on
//      the stdin prompt if genuinely signed out) — the existing --create-uuids
//      branch in scrape-shopvox-material-tiers.js already does this; this
//      script makes it the default rather than the exception, because this
//      run isn't necessarily launched by someone sitting at the keyboard
//      ready to press Enter.
//   2. Tab/section auto-expansion is SAFETY-SCOPED: only role="tab" elements,
//      elements whose class matches /tab/i, or elements whose text matches an
//      explicit "show more / expand" allowlist are ever clicked — same
//      "never touch Delete/Send/Void" discipline already documented in
//      shopvox-extract.mjs's scrapeGridPricing() SAFETY comment, applied here
//      because these are live financial documents, not a materials catalog.
//
// Usage:
//   node scripts/pilot-sames.mjs                    # full pilot run
//   node scripts/pilot-sames.mjs --debug            # screenshot every step
//   node scripts/pilot-sames.mjs --limit=5          # cap per entity at 5 (default 15)
//   node scripts/pilot-sames.mjs --entities=quotes,jobs  # scope to specific entities
//   node scripts/pilot-sames.mjs --inspect          # pause after finding the customer
//   node scripts/pilot-sames.mjs --cdp=http://localhost:9222  # attach to existing Chrome
//
// Output: scripts/pilot-sames/{quotes,sales_orders,invoices,purchase_orders,jobs}.json,
// scripts/pilot-sames/_summary.json, scripts/pilot-sames/raw/<entity>-sample.html,
// scripts/pilot-sames/screens/<entity>-sample.png
// ────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── CLI flags — identical getFlag/hasFlag pattern as both existing scrapers ──
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
const INSPECT = hasFlag('--inspect')
const CDP_URL = getFlag('--cdp')
const SCOPE_CAP = getFlag('--limit') ? parseInt(getFlag('--limit')) : 15
const ONLY_ENTITIES = getFlag('--entities') ? getFlag('--entities').split(',').map((s) => s.trim()) : null

// ── Files — new, isolated from the working scrapers' files ─────────────
const SESSION_DIR = resolve(__dirname, '.shopvox-session') // SHARED read-only reuse — same session dir shopvox-extract.mjs and scrape-shopvox-material-tiers.js already use. This file never writes scraper-specific state into it.
const OUTPUT_DIR = resolve(__dirname, 'pilot-sames')
const RAW_DIR = resolve(OUTPUT_DIR, 'raw')
const SCREENS_DIR = resolve(OUTPUT_DIR, 'screens')
const DEBUG_DIR = resolve(__dirname, 'shopvox-debug') // shared debug dir, same as both existing scrapers

for (const d of [OUTPUT_DIR, RAW_DIR, SCREENS_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true })
if (DEBUG && !existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true })

function saveJson(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2)) }

// ── Helpers — copied verbatim from shopvox-extract.mjs ──────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function screenshot(page, label) {
  if (!DEBUG) return
  const safe = label.replace(/[^\w-]+/g, '_').slice(0, 80)
  const path = resolve(DEBUG_DIR, `${Date.now()}_${safe}.png`)
  try { await page.screenshot({ path, fullPage: true }) } catch {}
}

// ── closeOpenModal — copied verbatim from shopvox-extract.mjs:527-571 ───
async function closeOpenModal(page) {
  if (!(await page.$('._ModalOverlay_1tz2y_28'))) return
  const overlayGone = async () => !(await page.$('._ModalOverlay_1tz2y_28'))
  try {
    const xBtn = page.locator('._button_pckdd_26 button, ._button_pckdd_26').first()
    if ((await xBtn.count()) > 0) {
      await xBtn.click({ timeout: 1000, force: true })
      await sleep(300)
      if (await overlayGone()) { await sleep(300); return }
    }
  } catch {}
  await page.keyboard.press('Escape')
  await sleep(300)
  if (await overlayGone()) { await sleep(300); return }
  try {
    const cancelBtn = page.locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label="Close"]').first()
    if ((await cancelBtn.count()) > 0) {
      await cancelBtn.click({ timeout: 1000, force: true })
      await sleep(300)
      if (await overlayGone()) { await sleep(300); return }
    }
  } catch {}
  try {
    await page.locator('._ModalOverlay_1tz2y_28').click({ timeout: 1000, force: true, position: { x: 10, y: 10 } })
    await sleep(300)
    if (await overlayGone()) { await sleep(300); return }
  } catch {}
  await page.evaluate(() => { document.querySelector('._ModalOverlay_1tz2y_28')?.remove() })
  await sleep(500)
  console.log('  WARNING: closeOpenModal — hard DOM removal needed (overlay was stuck)')
}

// ── launchBrowser — copied verbatim (pattern) from scrape-shopvox-material-tiers.js:1064-1086 ──
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

const URLS = {
  customersList: 'https://express.shopvox.com/customers',
}

// ── ensureLoggedIn — the SAME stdin-gated manual login + 2-consecutive-
// reads-5s-apart confirmation from scrape-shopvox-material-tiers.js:1088-1134,
// unchanged. Only called conditionally by main() (see DEVIATION #1 above) —
// this function itself is not modified from the proven version.
async function ensureLoggedIn(page) {
  console.log('\n────────────────────────────────────────────────────────')
  console.log('  MANUAL STEP — in the open Chromium window:')
  console.log('    1. Log into ShopVOX if not already logged in')
  console.log(`       (session is shared with shopvox-extract.mjs / scrape-shopvox-material-tiers.js — already logged in there? you're set)`)
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

// DEVIATION #1: lightweight check first, same pattern already used in
// scrape-shopvox-material-tiers.js's --create-uuids branch (main():1213-1220)
// — only fall into the blocking ensureLoggedIn() prompt if genuinely signed
// out, so a valid persisted session doesn't hang the run on a prompt no one
// is there to answer.
async function ensureLoggedInLazy(page) {
  await page.goto(URLS.customersList, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {})
  if (/\/sign-in/i.test(page.url())) {
    console.log('  Not signed in — falling back to the manual login prompt.')
    await ensureLoggedIn(page)
  } else {
    console.log(`  Already signed in (session reused from ${SESSION_DIR}) — skipping the manual prompt.`)
  }
}

// ── GENERIC EXTRACTOR — the core deliverable of this pilot. Runs entirely
// inside page.evaluate (self-contained, no closures over Node variables).
// Deliberately NOT a curated field list — harvests everything visible via
// several independent heuristics, tagged by `source`/`kind` so a human can
// judge signal quality afterward without losing anything an extra heuristic
// found. Over-capture is the explicit goal here, not a curated schema.
function _genericExtractPage() {
  const url = location.href
  const idMatch = url.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)
  const recordId = idMatch ? idMatch[0] : null

  const pairs = []
  const seenPairKeys = new Set()
  function pushPair(label, value, source) {
    label = (label || '').trim()
    value = value == null ? '' : String(value).trim()
    if (!label || label.length > 80) return
    const key = source + '|' + label + '|' + value
    if (seenPairKeys.has(key)) return
    seenPairKeys.add(key)
    pairs.push({ label, value, source })
  }

  // Pattern A — <p> label + trailing sibling span value. Confirmed live
  // ShopVOX form pattern (scrape-shopvox-material-tiers.js's
  // _extractAllMaterialFields, lines 267-290).
  for (const p of document.querySelectorAll('p')) {
    const label = p.innerText.trim()
    if (!label || label.length > 60) continue
    const container = p.parentElement
    if (!container) continue
    const spans = container.querySelectorAll('span')
    if (spans.length) {
      const val = spans[spans.length - 1].innerText
      if (val && val.trim() !== label) pushPair(label, val, 'p_span')
    }
  }

  // Pattern B — [class*="_floatingWrapper"] label+input. Confirmed live
  // ShopVOX form pattern (shopvox-extract.mjs's basicPricing reader, lines 890-925).
  for (const w of document.querySelectorAll('[class*="_floatingWrapper"], .field-wrapper-container')) {
    const labelEl = w.querySelector('label, [class*="_floatingLabel"]')
    if (!labelEl) continue
    const label = labelEl.innerText.trim().replace(/\*$/, '').trim()
    if (!label) continue
    const input = w.querySelector('input, select, textarea')
    const singleValue = w.querySelector('[class*="singleValue"]')
    let value = null
    if (singleValue) value = singleValue.innerText
    else if (input) value = input.type === 'checkbox' ? (input.checked ? 'true' : 'false') : input.value
    if (value != null && value !== '') pushPair(label, value, 'floatingWrapper')
  }

  // Pattern C — generic <label> + sibling input/text. Not a ShopVOX-specific
  // pattern, a broad fallback for any standard form markup.
  for (const lab of document.querySelectorAll('label')) {
    const label = lab.innerText.trim()
    if (!label || label.length > 60) continue
    const valEl = lab.nextElementSibling
    let value = null
    if (valEl) {
      const input = valEl.matches?.('input,select,textarea') ? valEl : valEl.querySelector?.('input,select,textarea')
      if (input) value = input.type === 'checkbox' ? (input.checked ? 'true' : 'false') : input.value
      else value = valEl.innerText
    }
    if (value) pushPair(label, value, 'label_sibling')
  }

  // Pattern D — <dl>/<dt>/<dd> definition lists, if any are used anywhere on the page.
  for (const dl of document.querySelectorAll('dl')) {
    for (const dt of dl.querySelectorAll('dt')) {
      const dd = dt.nextElementSibling
      if (dd && dd.tagName === 'DD') pushPair(dt.innerText, dd.innerText, 'dl_dt_dd')
    }
  }

  // ── Tables ──
  const tables = []

  // Native <table> elements.
  document.querySelectorAll('table').forEach((table, ti) => {
    const headerCells = Array.from(table.querySelectorAll('thead th, thead td')).map((c) => c.innerText.trim())
    const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
    const rows = bodyRows.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td,th')).map((c) => {
        const input = c.querySelector('input,textarea')
        return (input ? input.value : c.innerText).trim()
      })
      if (headerCells.length && headerCells.length === cells.length) {
        const obj = {}
        headerCells.forEach((h, i) => { obj[h || `col${i}`] = cells[i] })
        return obj
      }
      return { _cells: cells }
    })
    tables.push({ index: `html_${ti}`, kind: 'html_table', headers: headerCells, rowCount: rows.length, rows })
  })

  // ShopVOX's custom CSS-module grid — proven structure from
  // scrape-shopvox-material-tiers.js's _extractPricingMatrix/_extractVendorPricing
  // (root class *_tableExcel_*/_wrapper_12otk_*, rows *_rowComponent_*, cells
  // *_contentCell_* with a `header="ColumnName"` attribute). Generalized here
  // to ANY such grid on the page — this is the mechanism most likely to hold
  // line items (quantities, modifiers, discounts, totals) if quote/invoice
  // detail pages use the same UI kit as material pricing grids.
  document.querySelectorAll('[class*="_tableExcel_"], [class*="_wrapper_12otk_"]').forEach((root, gi) => {
    try {
      const wrapper = root.children[0] || root
      const header = wrapper.children[0]
      const body = wrapper.children[1] || wrapper
      const headerCellEls = header ? Array.from(header.querySelectorAll('[class*="_headerCell_"], [header]')) : []
      const headers = headerCellEls.map((h) => (h.getAttribute('header') || h.innerText || '').trim())
      const rowEls = Array.from(body.querySelectorAll('[class*="_rowComponent_"]'))
      const rows = rowEls.map((r) => {
        const cells = Array.from(r.querySelectorAll('[class*="_contentCell_"]'))
        const obj = {}
        cells.forEach((c, ci) => {
          const input = c.querySelector('input,textarea')
          const val = (input ? input.value : c.innerText).trim()
          const headerName = c.getAttribute('header') || headers[ci] || `col${ci}`
          obj[headerName] = val
        })
        return obj
      })
      if (rows.length || headers.length) tables.push({ index: `grid_${gi}`, kind: 'shopvox_grid', headers, rowCount: rows.length, rows })
    } catch {}
  })

  // ARIA table/grid roles — same virtualized-row shape confirmed live on the
  // products list (shopvox-extract.mjs's productListRow selector).
  document.querySelectorAll('[role="table"], [role="grid"]').forEach((root, gi) => {
    const headerEls = Array.from(root.querySelectorAll('[role="columnheader"]')).map((h) => h.innerText.trim())
    const rowEls = Array.from(root.querySelectorAll('[role="row"]')).filter((r) => !r.querySelector('[role="columnheader"]'))
    const rows = rowEls.map((r) => Array.from(r.querySelectorAll('[role="cell"], [role="gridcell"]')).map((c) => c.innerText.trim()))
    if (headerEls.length || rows.length) tables.push({ index: `aria_${gi}`, kind: 'aria_grid', headers: headerEls, rowCount: rows.length, rows })
  })

  // ── Links — href is the priority field per the brief; text is secondary. ──
  const ATTACHMENT_RE = /\.(pdf|jpe?g|png|gif|docx?|xlsx?|csv|zip|ai|eps|svg|tiff?)(\?|$)/i
  const links = Array.from(document.querySelectorAll('a[href]')).map((a) => {
    const href = a.getAttribute('href') || ''
    return {
      href,
      text: (a.innerText || '').trim(),
      looksLikeAttachment: ATTACHMENT_RE.test(href) || /\/(attachments?|uploads?|files?)\//i.test(href),
    }
  }).filter((l) => l.href)

  // ── Tab candidates — collection ONLY, no clicking here. Node-side caller
  // applies the safety allowlist/blocklist before ever clicking anything
  // (see DEVIATION #2 and expandSafeTabsAndMerge below).
  const tabCandidates = Array.from(document.querySelectorAll('[role="tab"], [class*="tab" i]'))
    .map((el) => (el.innerText || '').trim())
    .filter((t) => t && t.length > 0 && t.length < 40)
  const uniqueTabs = [...new Set(tabCandidates)]

  return {
    url, recordId, title: document.title,
    labelValuePairs: pairs,
    tables,
    links,
    tabCandidates: uniqueTabs,
    bodyTextLength: document.body.innerText.length,
  }
}

// Generic "list page signals" probe — date filter presence + any visible
// total-count text. Best-effort, not a guarantee ShopVOX exposes either.
function _detectListPageSignals() {
  const hasDateInput = !!document.querySelector('input[type="date"], input[placeholder*="date" i], [class*="datepicker" i]')
  const bodyText = document.body.innerText
  const totalMatch = bodyText.match(/(\d[\d,]*)\s+(results?|records?|items?|total)\b/i)
  return { hasDateInput, totalCountText: totalMatch ? totalMatch[0] : null }
}

// DEVIATION #2: safety-scoped tab/section expansion. ALLOWLIST: role="tab",
// class matching /tab/i, or text matching a "show more/expand" pattern.
// BLOCKLIST (hard veto even if allowlisted): any text suggesting a
// destructive or state-changing action. Never falls back to clicking a bare
// <button> generically — see file header DEVIATION #2 for why.
const SAFE_EXPAND_TEXT_RE = /^(show all|show more|show \d+|expand|view all|see all|load more|load \d+|overview|details|line items?|items?|payments?|notes?|activity|history|attachments?|files?|documents?|contacts?|addresses?|shipping|billing|terms|summary|revisions?|status|general|comments?)\b/i
const DANGEROUS_TEXT_RE = /delete|remove|void|cancel(?!led)|send|email|approve|reject|convert|archive|duplicate|clone|print|export|share|pay\b|charge|refund|submit|save\b|create\b|new\s/i

async function expandSafeTabsAndMerge(page) {
  const merged = { labelValuePairs: [], tables: [], links: [], tabsClicked: [], tabsSkippedAsUnsafe: [] }
  const seenLabelKeys = new Set()
  const seenLinkKeys = new Set()
  function mergeIn(extract, tabName) {
    for (const p of extract.labelValuePairs) {
      const k = `${p.source}|${p.label}|${p.value}`
      if (!seenLabelKeys.has(k)) { seenLabelKeys.add(k); merged.labelValuePairs.push({ ...p, tab: tabName }) }
    }
    for (const l of extract.links) {
      const k = `${l.href}|${l.text}`
      if (!seenLinkKeys.has(k)) { seenLinkKeys.add(k); merged.links.push({ ...l, tab: tabName }) }
    }
    for (const t of extract.tables) merged.tables.push({ ...t, tab: tabName })
  }

  const first = await page.evaluate(_genericExtractPage)
  mergeIn(first, null)
  merged.recordId = first.recordId
  merged.url = first.url
  merged.title = first.title
  merged.bodyTextLength = first.bodyTextLength

  for (const tabName of first.tabCandidates.slice(0, 20)) { // cap: guard against a pathological page with hundreds of "tab"-classed elements
    const safe = SAFE_EXPAND_TEXT_RE.test(tabName) || tabName.length < 30 // role=tab/class*=tab already filtered upstream in _genericExtractPage; short generic labels (e.g. "Quotes", "Jobs") are allowed through even if they don't match the word-list
    const dangerous = DANGEROUS_TEXT_RE.test(tabName)
    if (dangerous || !safe) { merged.tabsSkippedAsUnsafe.push(tabName); continue }
    try {
      const clicked = await page.evaluate((name) => {
        const els = Array.from(document.querySelectorAll('[role="tab"], [class*="tab" i]'))
        const el = els.find((e) => (e.innerText || '').trim() === name)
        if (el) { el.click(); return true }
        return false
      }, tabName)
      if (!clicked) continue
      await sleep(1200) // settle — same order of magnitude as the confirmed material-fields toggle race (scrape-shopvox-material-tiers.js:985)
      const extract = await page.evaluate(_genericExtractPage)
      mergeIn(extract, tabName)
      merged.tabsClicked.push(tabName)
    } catch (e) {
      merged.tabsClicked.push(`${tabName} (error: ${e.message?.split('\n')[0]})`)
    }
  }
  return merged
}

// ── Growth-polling "Load More" handler — same principle as
// scrape-shopvox-material-tiers.js's discoverMaterials() button-vanish fix:
// a button disappearing/re-rendering is NOT a completion signal; poll for
// actual link-count growth instead.
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

function dedupeByHref(links) {
  const seen = new Set()
  const out = []
  for (const l of links) {
    if (seen.has(l.href)) continue
    seen.add(l.href)
    out.push(l)
  }
  return out
}

// Generic "real content, not a loading spinner" gate — same principle as
// discoverMaterials()'s real-content waitForFunction
// (scrape-shopvox-material-tiers.js:605-618), which exists specifically
// because a cold Ember-app start (compiling routes, first API round-trip)
// can leave the page showing nothing (or just a spinner) for several
// seconds with no error. CONFIRMED LIVE in this pilot's first run: all
// three checkpoint screenshots in findCustomer() showed only a "..."
// loading-dots spinner, never real content, because the only wait was a
// fixed sleep(1500) — nowhere near enough. Polls for either a real link
// count or a search input, up to 30s, and throws (rather than silently
// proceeding against an empty/loading page) if neither ever appears.
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
    console.log(`  WARNING: ${label} never showed real content after ${timeoutMs / 1000}s (url: ${page.url()}) — proceeding anyway, likely to fail downstream. Check the screenshot.`)
    return false
  }
}

// CONFIRMED LIVE (this pilot's second run): a generic
// 'input[type="search"], input[placeholder*="earch" i]' selector matches
// TWO inputs on ShopVOX list pages — a global top-nav search box AND the
// list's own inline filter next to the "My View" selector (the same "My
// View" marker already proven in scrape-shopvox-material-tiers.js's
// selectMaterialsView). The generic selector grabbed the global nav one
// (querySelector returns the first DOM match, and the nav renders before
// the page body), which does not filter the list at all — the customers
// list still showed all 4,446 unfiltered records afterward. Scope
// specifically to an input living in the same toolbar container as "My
// View" when that marker is present; only fall back to "last input in DOM
// order" if it isn't.
async function typeIntoListSearchInput(page, query) {
  return page.evaluate((q) => {
    const inputs = Array.from(document.querySelectorAll('input[type="search"], input[placeholder*="earch" i]'))
    if (inputs.length === 0) return { done: false, candidateCount: 0 }
    const myView = Array.from(document.querySelectorAll('*'))
      .find((el) => el.children.length === 0 && /^My View$/i.test((el.innerText || '').trim()))
    let target = null
    if (myView) {
      let anc = myView.parentElement
      for (let i = 0; i < 6 && anc && !target; i++) {
        target = inputs.find((inp) => anc.contains(inp))
        anc = anc.parentElement
      }
    }
    if (!target) target = inputs[inputs.length - 1] // best-effort fallback if no "My View" marker on this page
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(target, q)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    return { done: true, candidateCount: inputs.length, usedMyViewScoping: !!myView }
  }, query)
}

// ── Customer discovery ───────────────────────────────────────────────────
async function findCustomer(page, name) {
  await page.goto(URLS.customersList, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await waitForRealContent(page, { label: 'customers_list' })
  await screenshot(page, 'customers_list_initial')

  const searchResult = await typeIntoListSearchInput(page, name)
  const searched = searchResult.done
  if (searched) console.log(`  Search input candidates: ${searchResult.candidateCount}, scoped-to-My-View: ${searchResult.usedMyViewScoping}`)
  if (searched) {
    console.log(`  Typed "${name}" into a search input — waiting for results to settle…`)
    await sleep(2000)
  } else {
    console.log('  WARNING: no search input found on the customers list page — falling back to scanning visible links/Load More.')
    await clickLoadMoreUntilExhausted(page)
  }
  await screenshot(page, 'customers_list_after_search')

  const found = await page.evaluate((q) => {
    const links = Array.from(document.querySelectorAll('a[href]'))
    const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()
    const target = norm(q)
    const exact = links.find((a) => norm(a.innerText) === target)
    const partial = links.find((a) => norm(a.innerText).includes(target))
    const el = exact || partial
    return el ? { href: el.getAttribute('href'), text: el.innerText.trim(), matchType: exact ? 'exact' : 'partial' } : null
  }, name)

  if (!found) {
    await screenshot(page, 'customer_search_not_found')
    throw new Error(`Could not find a link matching "${name}" on ${page.url()} after search attempt. Check the screenshot.`)
  }
  console.log(`  Matched (${found.matchType}): "${found.text}" -> ${found.href}`)

  const href = found.href.startsWith('http') ? found.href : new URL(found.href, URLS.customersList).href
  await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await waitForRealContent(page, { minLinks: 3, label: 'customer_detail' })
  await screenshot(page, 'customer_detail_loaded')

  const idMatch = href.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)
  return { url: href, id: idMatch ? idMatch[0] : null, matchedText: found.text }
}

// ── Entity config — URL guesses are exactly that: guesses to try, in order.
// discoverEntityRecords() reports back which one (if any) actually worked, so
// the final report reflects what was OBSERVED, not what was assumed here.
// CONFIRMED LIVE against this exact customer (a live probe run before this
// final version of the script, not guessed): ShopVOX quotes/sales-orders/
// invoices are NOT separate list pages at all — they are unified under ONE
// "Transactions" grid on the customer's own detail page
// (https://express.shopvox.com/customers/{id}, the default tab), with each
// row linking to /transactions/{type}/{uuid}. Jobs are a SEPARATE
// customer-scoped sub-route (/customers/{id}/jobs) linking to a top-level
// /jobs/{uuid} (not nested under /transactions/). Purchase orders were NOT
// found customer-scoped or globally — the one live sales order checked has
// a "Purchasing" sub-tab (/transactions/sales-orders/{id}/purchasing) that
// is almost certainly where a PO would surface, but this customer's sole
// checked sales order had none yet (status "In process", not yet at the
// purchasing stage) — so no real PO href was ever observed to confirm its
// exact detail-page URL shape. Global listUrlCandidates are kept only as a
// last-resort fallback (all 8 originally guessed came back empty against
// this live account) — customer-page/sub-tab discovery is the real path.
const ALL_ENTITIES = [
  {
    key: 'quotes', label: 'Quotes',
    hrefPatterns: [/^\/transactions\/quotes\/[0-9a-f]{8}-/i],
    discoverVia: 'customer_transactions_grid',
    listUrlCandidates: ['https://express.shopvox.com/quotes'],
  },
  {
    key: 'sales_orders', label: 'Sales Orders',
    hrefPatterns: [/^\/transactions\/sales-orders\/[0-9a-f]{8}-/i],
    discoverVia: 'customer_transactions_grid',
    listUrlCandidates: ['https://express.shopvox.com/sales-orders'],
  },
  {
    key: 'invoices', label: 'Invoices',
    hrefPatterns: [/^\/transactions\/invoices\/[0-9a-f]{8}-/i],
    discoverVia: 'customer_transactions_grid',
    listUrlCandidates: ['https://express.shopvox.com/invoices'],
  },
  {
    key: 'purchase_orders', label: 'Purchase Orders',
    hrefPatterns: [/^\/transactions\/purchase-orders\/[0-9a-f]{8}-/i, /^\/purchase-orders\/[0-9a-f]{8}-/i],
    discoverVia: 'none_confirmed', // see comment above — left in only so a future run can pick up a match if one exists
    listUrlCandidates: ['https://express.shopvox.com/purchase-orders'],
  },
  {
    key: 'jobs', label: 'Jobs',
    hrefPatterns: [/^\/jobs\/[0-9a-f]{8}-/i], // deliberately requires a UUID right after /jobs/ — a looser /\/jobs?\// pattern false-matched "/jobs/new" (the create-job action link) in this pilot's first run
    discoverVia: 'customer_jobs_subtab',
    subTabPath: '/jobs',
    listUrlCandidates: ['https://express.shopvox.com/jobs'],
  },
]
const ENTITIES = ONLY_ENTITIES ? ALL_ENTITIES.filter((e) => ONLY_ENTITIES.includes(e.key)) : ALL_ENTITIES

// Confirmed live: the Transactions grid and the Jobs sub-tab both take up
// to ~8s to resolve their async fetch (first pilot run's fixed 1500ms wait
// was nowhere near enough — same class of race documented at length in
// discoverMaterials()). Polls for the matching-link count to stop growing,
// rather than trusting a fixed delay.
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

// Same id can appear with several href suffixes on a source page (e.g. a
// bare /transactions/quotes/{id} row link vs. incidental /edit or /tasks
// variants elsewhere) — keep the shortest (most canonical) href per id.
function preferCanonicalHrefPerId(records) {
  const byId = new Map()
  for (const r of records) {
    const idMatch = r.href.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)
    const id = idMatch ? idMatch[0] : r.href
    const existing = byId.get(id)
    if (!existing || r.href.length < existing.href.length) byId.set(id, r)
  }
  return [...byId.values()]
}

// Reads a tab badge count like "Transactions\n\n(363)" or "Jobs\n\n(0/3)"
// from an already-harvested link list — the same links array _genericExtractPage
// produces. Returns the LAST number found in parens (so "(0/3)" -> 3).
function parseTabBadgeCount(links, tabLabelRegex) {
  const tab = links.find((l) => tabLabelRegex.test(l.text))
  if (!tab) return null
  const nums = [...tab.text.matchAll(/\((\d+)(?:\/(\d+))?\)/g)]
  if (!nums.length) return null
  const last = nums[nums.length - 1]
  return parseInt(last[2] ?? last[1], 10)
}

async function discoverEntityRecords(page, entity, customerPageLinks, customerUrl, customerName) {
  if (entity.discoverVia === 'customer_transactions_grid') {
    // CONFIRMED LIVE: quotes/sales-orders/invoices are unified on the
    // customer's own default tab (customerPageLinks was harvested from
    // there, AFTER waitForLinksToStopGrowing() in main() — see that call
    // site for why a plain fixed-delay wait wasn't enough).
    const matches = preferCanonicalHrefPerId(
      dedupeByHref(customerPageLinks.filter((l) => entity.hrefPatterns.some((re) => re.test(l.href))))
    )
    return {
      records: matches,
      totalAvailable: parseTabBadgeCount(customerPageLinks, /^Transactions/i) ?? matches.length,
      sourceMethod: 'customer_transactions_grid',
      listUrlUsed: customerUrl,
      dateFilterObserved: null, // a filter-funnel icon is present on this grid but was not exercised in this pilot — see report
      totalCountObserved: parseTabBadgeCount(customerPageLinks, /^Transactions/i),
    }
  }

  if (entity.discoverVia === 'customer_jobs_subtab') {
    const subUrl = customerUrl + entity.subTabPath
    await page.goto(subUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await waitForLinksToStopGrowing(page, '/jobs/')
    const extract = await page.evaluate(_genericExtractPage)
    const matches = preferCanonicalHrefPerId(
      dedupeByHref(extract.links.filter((l) => entity.hrefPatterns.some((re) => re.test(l.href))))
    )
    return {
      records: matches,
      totalAvailable: parseTabBadgeCount(extract.links, /^Jobs/i) ?? matches.length,
      sourceMethod: 'customer_jobs_subtab',
      listUrlUsed: subUrl,
      dateFilterObserved: null,
      totalCountObserved: parseTabBadgeCount(extract.links, /^Jobs/i),
    }
  }

  // discoverVia === 'none_confirmed' (purchase_orders) — no customer-scoped
  // or global source was ever confirmed live for this entity (see the
  // comment on ALL_ENTITIES). One best-effort attempt at the global guess,
  // purely so a future run could pick up a hit if ShopVOX exposes one —
  // expected to return not_found based on this pilot's live findings.
  for (const listUrl of entity.listUrlCandidates) {
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    if (/\/sign-in/i.test(page.url())) continue
    await waitForRealContent(page, { label: `${entity.key}_list` })
    const extract = await page.evaluate(_genericExtractPage)
    const matches = preferCanonicalHrefPerId(dedupeByHref(extract.links.filter((l) => entity.hrefPatterns.some((re) => re.test(l.href)))))
    if (matches.length > 0) {
      return { records: matches, totalAvailable: matches.length, sourceMethod: 'global_list_unconfirmed_guess', listUrlUsed: listUrl, dateFilterObserved: null, totalCountObserved: null }
    }
  }
  return {
    records: [], totalAvailable: 0, sourceMethod: 'not_found_no_confirmed_source',
    listUrlUsed: null, dateFilterObserved: null, totalCountObserved: null,
  }
}

// ── Per-record extraction ────────────────────────────────────────────────
async function extractOneRecord(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  // Generic "real content loaded" wait — no entity-specific text signal is
  // known ahead of time (unlike extractOneMaterial's "Pricing Matrix" wait),
  // so this waits for body text to stop growing across two 1s-apart reads —
  // same spirit as extractProduct's title-changed + selector-present dual
  // check (shopvox-extract.mjs:834-846), adapted for an unknown DOM shape.
  // Require a MINIMUM length, not just stability — a stable loading spinner
  // ("...", confirmed live to be the real failure mode in this pilot's first
  // run against the customers list) would otherwise pass as "stable content."
  let lastLen = -1
  let stable = false
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    const len = await page.evaluate(() => document.body.innerText.length).catch(() => 0)
    if (len > 100 && len === lastLen) { stable = true; break }
    lastLen = len
  }
  if (!stable) console.log(`    WARNING: body text never stabilized above the loading-spinner floor after 30s at ${url} — extracting anyway`)
  await closeOpenModal(page)
  const merged = await expandSafeTabsAndMerge(page)
  return merged
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const runStartedAt = new Date().toISOString()
  const { context } = await launchBrowser()
  const page = context.pages()[0] ?? (await context.newPage())
  page.on('console', (msg) => { if (msg.type() === 'log' && DEBUG) console.log('  BROWSER:', msg.text()) })

  await ensureLoggedInLazy(page)

  console.log(`\nSearching for customer "Sames Auto Arena"…`)
  const customer = await findCustomer(page, 'Sames Auto Arena')
  console.log(`Customer found: ${customer.matchedText} (id: ${customer.id ?? 'NONE FOUND IN URL'})`)
  console.log(`Customer detail URL: ${customer.url}`)

  if (INSPECT) {
    console.log('\n--inspect: pausing for manual look. Press ENTER to continue…')
    process.stdin.resume(); process.stdin.setEncoding('utf8')
    await new Promise((res) => process.stdin.once('data', () => res()))
    process.stdin.pause()
  }

  // CONFIRMED LIVE: waitForRealContent() inside findCustomer() only gates on
  // *some* content (nav links / search input) being present — it does NOT
  // wait for the Transactions grid's own async fetch, which this pilot's
  // second run confirmed can take ~8s. Without this, customerPageExtract
  // below silently captures only the small summary-widget shell (body
  // length 546, confirmed live), not the 363-row grid — exactly the failure
  // this line exists to prevent.
  await waitForLinksToStopGrowing(page, '/transactions/')
  // The grid only auto-loads its first ~50-row batch (confirmed live: 100
  // matching links = ~50 rows × 2 links/row). Quotes/sales-orders/invoices
  // are interleaved in this one grid, so a couple more "Load 50 More
  // Transactions" batches meaningfully improves the odds of finding 15 of
  // EACH type rather than just 15 total, skewed toward whichever type
  // happens to dominate the most recent 50.
  await clickLoadMoreUntilExhausted(page, 2).catch(() => {})
  const customerPageExtract = await expandSafeTabsAndMerge(page)
  saveJson(resolve(OUTPUT_DIR, 'customer_detail_page.json'), {
    customerName: 'Sames Auto Arena',
    customerUrl: customer.url,
    customerId: customer.id,
    ...customerPageExtract,
  })
  writeFileSync(resolve(RAW_DIR, 'customer-detail-sample.html'), await page.content(), 'utf8')
  await page.screenshot({ path: resolve(SCREENS_DIR, 'customer-detail-sample.png'), fullPage: true }).catch(() => {})

  const summary = { runStartedAt, customer: { name: 'Sames Auto Arena', url: customer.url, id: customer.id }, scopeCap: SCOPE_CAP, entities: {} }

  for (const entity of ENTITIES) {
    console.log(`\n=== ${entity.label} ===`)
    const entityStart = Date.now()
    const discovery = await discoverEntityRecords(page, entity, customerPageExtract.links, customer.url, 'Sames Auto Arena')
    console.log(`  Discovery method: ${discovery.sourceMethod}; totalAvailable(observed)=${discovery.totalAvailable}; listUrlUsed=${discovery.listUrlUsed}; dateFilterObserved=${discovery.dateFilterObserved}; totalCountObserved=${discovery.totalCountObserved}`)

    const capped = discovery.records.length > SCOPE_CAP
    const toProcess = discovery.records.slice(0, SCOPE_CAP)
    if (capped) console.log(`  Capping at ${SCOPE_CAP} of ${discovery.records.length} discovered records (scope cap).`)

    const records = []
    const errors = []
    let firstSampleSaved = false

    for (let i = 0; i < toProcess.length; i++) {
      const link = toProcess[i]
      const recordUrl = link.href.startsWith('http') ? link.href : new URL(link.href, URLS.customersList).href
      const startedAt = new Date().toISOString()
      const t0 = Date.now()
      try {
        const extracted = await extractOneRecord(page, recordUrl)
        const endedAt = new Date().toISOString()
        const elapsedSeconds = (Date.now() - t0) / 1000
        records.push({ sourceLinkText: link.text, sourceHref: link.href, startedAt, endedAt, elapsedSeconds, ...extracted })
        console.log(`  [${i + 1}/${toProcess.length}] ${recordUrl} -> ${elapsedSeconds.toFixed(1)}s, ${extracted.labelValuePairs.length} label/value pairs, ${extracted.tables.length} tables, ${extracted.links.length} links`)

        if (!firstSampleSaved) {
          firstSampleSaved = true
          writeFileSync(resolve(RAW_DIR, `${entity.key}-sample.html`), await page.content(), 'utf8')
          await page.screenshot({ path: resolve(SCREENS_DIR, `${entity.key}-sample.png`), fullPage: true }).catch(() => {})
        }
      } catch (e) {
        const endedAt = new Date().toISOString()
        const elapsedSeconds = (Date.now() - t0) / 1000
        errors.push({ sourceHref: link.href, startedAt, endedAt, elapsedSeconds, error: e instanceof Error ? e.message : String(e) })
        console.log(`  [${i + 1}/${toProcess.length}] ${recordUrl} -> ERROR: ${e instanceof Error ? e.message : e} (continuing to next record)`)
      }
    }

    saveJson(resolve(OUTPUT_DIR, `${entity.key}.json`), {
      customer: 'Sames Auto Arena',
      entity: entity.key,
      discoveryMethod: discovery.sourceMethod,
      listUrlUsed: discovery.listUrlUsed,
      dateFilterObserved: discovery.dateFilterObserved,
      totalCountObserved: discovery.totalCountObserved,
      totalAvailable: discovery.totalAvailable,
      capped,
      recordsCaptured: records.length,
      records,
      errors,
    })

    const entityElapsedSeconds = (Date.now() - entityStart) / 1000
    const perRecordSeconds = records.map((r) => r.elapsedSeconds)
    const meanSecondsPerRecord = perRecordSeconds.length ? perRecordSeconds.reduce((a, b) => a + b, 0) / perRecordSeconds.length : null
    const slowestRecordSeconds = perRecordSeconds.length ? Math.max(...perRecordSeconds) : null
    const recordsPerHourObserved = meanSecondsPerRecord ? Math.round(3600 / meanSecondsPerRecord) : null

    summary.entities[entity.key] = {
      totalAvailable: discovery.totalAvailable,
      recordsCaptured: records.length,
      errorCount: errors.length,
      capped,
      discoveryMethod: discovery.sourceMethod,
      listUrlUsed: discovery.listUrlUsed,
      dateFilterObserved: discovery.dateFilterObserved,
      totalCountObserved: discovery.totalCountObserved,
      totalElapsedSeconds: entityElapsedSeconds,
      meanSecondsPerRecord,
      slowestRecordSeconds,
      recordsPerHourObserved,
    }
    saveJson(resolve(OUTPUT_DIR, '_summary.json'), summary) // checkpoint after every entity
    console.log(`  ${entity.label} summary: ${records.length} captured, ${errors.length} errors, mean ${meanSecondsPerRecord?.toFixed(1)}s/record, ~${recordsPerHourObserved} records/hour observed`)
  }

  summary.runEndedAt = new Date().toISOString()
  saveJson(resolve(OUTPUT_DIR, '_summary.json'), summary)

  console.log('\n=========== PILOT RESULT ===========')
  console.log(JSON.stringify(summary, null, 2))
  console.log(`\nOutput written to ${OUTPUT_DIR}`)

  await context.close()
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})

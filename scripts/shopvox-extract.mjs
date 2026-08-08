// ShopVOX full recipe extractor via Playwright.
//
// Navigates ShopVOX, searches each PrintOS product by name, opens the
// Configure Pricing tab, expands Modifiers / Dropdown Menus / Default Items,
// and writes the extracted recipe back into products.shopvox_data in Supabase.
//
// Prerequisites:
//   npm install --save-dev playwright
//   npx playwright install chromium
//
// First run: a Chromium window opens. Log into ShopVOX in that window (one time).
// The session is persisted to `scripts/.shopvox-session/` and reused afterward.
//
// Usage:
//   node scripts/shopvox-extract.mjs                 # all pending products
//   node scripts/shopvox-extract.mjs --limit 3       # first 3 (smoke test)
//   node scripts/shopvox-extract.mjs --product "Banner Regular"
//   node scripts/shopvox-extract.mjs --resume        # skip already-extracted (default)
//   node scripts/shopvox-extract.mjs --no-resume     # re-extract everything
//   node scripts/shopvox-extract.mjs --debug         # screenshot every step
//   node scripts/shopvox-extract.mjs --inspect       # pause after search for manual inspection
//   node scripts/shopvox-extract.mjs --cdp=http://localhost:9222  # attach to existing Chrome
//
// ────────────────────────────────────────────────────────────────────────
// ⚠ SELECTORS ARE GUESSES. First run will almost certainly fail on selectors.
// Edit the SELECTORS block below as you iterate. Use --debug to capture screenshots.
// ────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

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

const LIMIT = getFlag('--limit') ? parseInt(getFlag('--limit')) : null
const ONLY_PRODUCT = getFlag('--product')
const RESUME = !hasFlag('--no-resume')           // resume is the default
const DEBUG = hasFlag('--debug')
const INSPECT = hasFlag('--inspect')
const CDP_URL = getFlag('--cdp')

// Diagnostic snapshot is taken only on the first product we extract.
let firstProduct = true

// ── .env.local ────────────────────────────────────────────────────────
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
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env vars.'); process.exit(1) }
const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── Files ─────────────────────────────────────────────────────────────
const SESSION_DIR    = resolve(__dirname, '.shopvox-session')
const DEBUG_DIR      = resolve(__dirname, 'shopvox-debug')
const PROGRESS_FILE  = resolve(__dirname, 'shopvox-extract-progress.json')
const ERRORS_FILE    = resolve(__dirname, 'shopvox-extract-errors.json')
const ORPHANS_FILE   = resolve(__dirname, 'shopvox-extract-orphans.json')

if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })
if (DEBUG && !existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true })

function loadJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
function saveJson(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2)) }

const progress = RESUME ? loadJson(PROGRESS_FILE, { done: {}, started_at: new Date().toISOString() }) : { done: {}, started_at: new Date().toISOString() }
const errors   = loadJson(ERRORS_FILE,   { errors: [] })
const orphans  = loadJson(ORPHANS_FILE,  { orphans: [] })

// ────────────────────────────────────────────────────────────────────────
// SELECTORS — edit me as you iterate
// Prefer Playwright's locator API (role / text / label) — more resilient
// than raw CSS. Fall back to CSS/XPath only when nothing semantic works.
// ────────────────────────────────────────────────────────────────────────
const URLS = {
  base: 'https://express.shopvox.com',
  products: 'https://express.shopvox.com/settings/products',
}

const SELECTORS = {
  // Log-in detection — kept for legacy reference (currently unused; the
  // manual-step prompt supersedes automatic login detection).
  loggedOutUrlPattern: /\/login|\/sign[- ]?in/i,

  // Products list page — confirmed from live HTML dump. All 752 products
  // render on a single page (no pagination); rows are virtualized <div>s.
  productListContainer: 'div#products',
  productListRow:       'div[aria-roledescription="sortable"]',
  productListLink:      'a[href^="/settings/products/"]',
}

// ── Helpers ───────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function screenshot(page, label) {
  if (!DEBUG) return
  const safe = label.replace(/[^\w-]+/g, '_').slice(0, 80)
  const path = resolve(DEBUG_DIR, `${Date.now()}_${safe}.png`)
  try { await page.screenshot({ path, fullPage: true }) } catch {}
}

// ── Recipe-data check ────────────────────────────────────────────────
// A product counts as "already extracted" only if shopvox_data carries
// at least one non-empty recipe array. Empty/missing arrays mean the
// previous run finished but produced no real data — re-extract.
function hasRealRecipeData(sv) {
  if (!sv) return false
  const nonEmpty = (a) => Array.isArray(a) && a.length > 0
  return nonEmpty(sv.modifiers) || nonEmpty(sv.default_items) || nonEmpty(sv.dropdown_menus)
}

// ── Supabase: per-ShopVOX-URL lookup ──────────────────────────────────
// ShopVOX now drives the loop — for each URL we scraped, look up a
// matching PrintOS row. Try shopvox_data->>'id' first, then fall back
// to a case-insensitive name match. Returns { product, matchedBy } or null.
async function lookupPrintOSProduct(sv) {
  if (sv.shopvoxId) {
    const { data, error } = await sb
      .from('products')
      .select('id, name, shopvox_data, migration_status')
      .eq('organization_id', ORG_ID)
      .eq('shopvox_data->>id', sv.shopvoxId)
      .limit(1)
    if (error) throw new Error(`lookup by shopvox_data.id: ${error.message}`)
    if (data && data[0]) return { product: data[0], matchedBy: 'shopvox_data.id' }
  }
  if (sv.name) {
    const { data, error } = await sb
      .from('products')
      .select('id, name, shopvox_data, migration_status')
      .eq('organization_id', ORG_ID)
      .ilike('name', sv.name)
      .limit(1)
    if (error) throw new Error(`lookup by name: ${error.message}`)
    if (data && data[0]) return { product: data[0], matchedBy: 'name' }
  }
  return null
}

// ── Collect every ShopVOX product URL from the list page ──────────────
// Two-phase scrape to maximize coverage:
//   1. "Load All" in My View (user already did this before pressing ENTER)
//   2. Cycle through Disabled + Drafts (filtered-out from Load All)
// Each row has 2 <a> tags pointing at the same /settings/products/:id,
// so dedupe by href via a Map. Returns [{ url, name }, ...].

// Scrape every product link currently rendered and merge into byHref.
// Returns the number of NEW hrefs added (dedupes, upgrades empty names).
async function scrapeVisibleLinks(page, byHref) {
  const pairs = await page.$$eval(SELECTORS.productListLink, (els) =>
    els.map((el) => ({
      href: el.getAttribute('href') || '',
      text: (el.textContent || '').trim(),
    })),
  )
  let added = 0
  for (const { href, text } of pairs) {
    if (!href) continue
    if (!byHref.has(href)) { byHref.set(href, text); added++ }
    else if (text && !byHref.get(href)) byHref.set(href, text) // upgrade empty name
  }
  return added
}

// Switch the products list to a different saved view via the dropdown.
// Dropdown button is inside div[aria-haspopup="dialog"] and shows the
// current view's name; clicking it opens a dialog with the view options.
async function switchToView(page, currentView, targetView) {
  // The view switcher button contains a <span> with the view name plus a chevron
  // SVG. The adjacent sort button has only an SVG — no span. :has(span) is the
  // stable distinguisher regardless of which view is currently selected.
  const dropdownBtn = page
    .locator('div[aria-haspopup="dialog"] button:has(span)')
    .first()
  await dropdownBtn.click({ timeout: 5000 })
  await sleep(400)

  let option = page
    .locator(`[role="dialog"] :text-is("${targetView}"), [role="dialog"] button:has-text("${targetView}")`)
    .first()
  if (await option.count() === 0) {
    option = page.getByText(targetView, { exact: true }).first()
  }
  await option.click({ timeout: 5000 })
}

async function collectAllProductUrls(page) {
  const byHref = new Map()

  // Wait for the list to stabilize after ENTER. Take an initial count after
  // 3 seconds, then keep polling until the count stops changing. Timeout after
  // 2 minutes in case something is genuinely stuck.
  console.log('  Waiting 3s for initial row count…')
  await sleep(3000)
  let baseline = await page.locator(SELECTORS.productListRow).count()
  console.log(`  Baseline: ${baseline} rows — watching for changes…`)
  const stabilizeDeadline = Date.now() + 120_000
  while (true) {
    await sleep(1000)
    const current = await page.locator(SELECTORS.productListRow).count()
    if (current !== baseline) {
      baseline = current
      console.log(`  Still loading… ${baseline} rows`)
    } else {
      break
    }
    if (Date.now() > stabilizeDeadline) {
      console.warn(`  ⚠ Timed out waiting for row count to stabilize — proceeding with ${baseline}`)
      break
    }
  }
  console.log(`  Row count stable: ${baseline} rows`)

  // Phase 1 — scrape the "Load All" state the user set up manually.
  await screenshot(page, 'list-load-all')
  await scrapeVisibleLinks(page, byHref)
  console.log(`  Load All: ${byHref.size} URLs`)

  // Phase 2 — cycle through views that are filtered out of Load All.
  // My View / Enabled / Golden Products / Published overlap, so skip them.
  const EXTRA_VIEWS = ['Disabled', 'Drafts']
  let currentView = 'My View' // starting state (Load All was done within My View)
  for (const view of EXTRA_VIEWS) {
    try {
      await switchToView(page, currentView, view)
      currentView = view
    } catch (e) {
      console.warn(`  (could not switch to "${view}": ${e.message}) — skipping`)
      continue
    }
    try {
      await page.waitForSelector(SELECTORS.productListRow, { timeout: 10000, state: 'visible' })
    } catch {
      console.warn(`  (no sortable rows visible in "${view}") — 0 added`)
      continue
    }
    await sleep(500) // let the list settle
    await screenshot(page, `list-${view.toLowerCase()}`)
    await scrapeVisibleLinks(page, byHref)
    console.log(`  After ${view}: ${byHref.size} URLs`)
  }

  console.log(`  Total unique: ${byHref.size} URLs`)

  // Filter out category/taxonomy links that also live under /settings/products/
  // but aren't individual products. Keep anything whose link text looks like
  // a real product name (4+ chars and not in the known-category blocklist).
  const NON_PRODUCT_NAMES = new Set([
    'Product Types',
    'Product Type',
    'Categories',
    'Category',
    'Tags',
    'Brands',
    'Brand',
    'Units',
    'Unit',
  ])
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const out = []
  let filtered = 0
  for (const [href, name] of byHref) {
    const trimmed = (name || '').trim()
    if (!trimmed || trimmed.length < 4 || NON_PRODUCT_NAMES.has(trimmed)) {
      filtered++
      continue
    }
    // Reject placeholder links like /settings/products/undefined or any
    // href whose trailing segment isn't a real UUID.
    const id = extractShopvoxId(href)
    if (!id || !UUID_RE.test(id)) {
      console.warn(`  SKIP non-UUID id "${id}" from href "${href}" (name: "${trimmed}")`)
      filtered++
      continue
    }
    out.push({
      url: href.startsWith('http') ? href : URLS.base + href,
      name: trimmed,
      shopvoxId: id,
    })
  }
  console.log(`  Filtered non-products: ${filtered}  (kept ${out.length})`)
  return out
}

// Parse the ShopVOX product UUID out of a /settings/products/{uuid} href.
// Strip any query string or trailing slash, then take the final path segment.
function extractShopvoxId(href) {
  if (!href) return null
  const clean = href.split('?')[0].replace(/\/+$/, '')
  const tail = clean.split('/').pop()
  return tail || null
}

// ── Modal-extraction helpers ──────────────────────────────────────────

// Extract structured fields from whichever Edit-* modal is currently open.
// Returns a discriminated-union object keyed by `type`, or null if no modal.
async function extractModalFields(page) {
  return await page.evaluate(() => {
    // Find modal: prefer the known CSS class, fall back to scanning all divs.
    const modal =
      document.querySelector('._ModalContent_1tz2y_44') ||
      Array.from(document.querySelectorAll('div')).find((d) => {
        const h = d.querySelector('h2, h3, h4')
        return h && (h.innerText || '').includes('Edit')
      })
    console.log('Modal element:', modal?.className)
    if (!modal) return null

    const norm = (s) => (s || '').trim().replace(/^\*\s*/, '')

    const getField = (labelText) => {
      const allEls = Array.from(modal.querySelectorAll('*'))
      const label = allEls.find(
        (el) => norm(el.innerText) === labelText && el.children.length <= 2,
      )
      if (!label) return null
      const container = label.closest('div')
      if (!container) return null
      const input = container.querySelector('input, select, textarea')
      if (input) return input.type === 'checkbox' ? input.checked : input.value
      const sibling = label.nextElementSibling
      return (sibling?.innerText || '').trim() || null
    }

    const getCheckbox = (labelText) => {
      const cands = Array.from(modal.querySelectorAll('label, span, p'))
      const label = cands.find((el) => norm(el.innerText) === labelText)
      if (!label) return false
      const wrapper = label.parentElement?.tagName === 'LABEL' ? label.parentElement : null
      const cb =
        wrapper?.querySelector('input[type="checkbox"]') ||
        label.closest('div')?.querySelector('input[type="checkbox"]') ||
        label.previousElementSibling?.querySelector('input[type="checkbox"]') ||
        label.querySelector('input[type="checkbox"]')
      return cb ? !!cb.checked : false
    }

    const getDropdownValue = (labelText) => {
      const allEls = Array.from(modal.querySelectorAll('*'))
      const label = allEls.find(
        (el) => norm(el.innerText) === labelText && el.tagName !== 'OPTION',
      )
      if (!label) return null
      const container =
        label.closest('div[class*="select"], div[class*="dropdown"]') ||
        label.parentElement?.parentElement
      if (!container) return null
      // ShopVOX uses react-select; the selected value lives in a class containing
      // "singleValue" (capital V) — [class*="value"] (lowercase) never matched it.
      const displayed =
        container.querySelector('[class*="singleValue"]') ||
        container.querySelector('[class*="value"], [class*="selected"]')
      if (displayed) return (displayed.innerText || '').trim() || null
      const select = container.querySelector('select')
      if (select) return select.options[select.selectedIndex]?.text
      return null
    }

    // Find heading using cascade of selectors, then fall back to old h2/h3/h4.
    let heading = ''
    for (const sel of [
      '._ModalContent_1tz2y_44 h1',
      '._ModalContent_1tz2y_44 h2',
      '._ModalContent_1tz2y_44 h3',
      '._ModalContent_1tz2y_44 [class*="heading"]',
      '._ModalContent_1tz2y_44 [class*="title"]',
    ]) {
      const el = document.querySelector(sel)
      if (el) { const t = (el.innerText || '').trim(); if (t) { heading = t; break } }
    }
    if (!heading) {
      const content = document.querySelector('._ModalContent_1tz2y_44')
      if (content) {
        const el = Array.from(content.querySelectorAll('div')).find(
          (e) => (e.innerText || '').trim().startsWith('Edit') && e.children.length <= 3,
        )
        if (el) heading = (el.innerText || '').trim().split('\n')[0].trim()
      }
    }
    if (!heading) heading = (modal.querySelector('h1, h2, h3, h4')?.innerText || '').trim()
    console.log('Modal heading found:', heading)

    if (heading.includes('Default Item')) {
      const _formula      = getDropdownValue('Formula') || getDropdownValue('System Formula')
      const _numMod       = getDropdownValue('Attach to a Numeric Modifier')
      const _chkMod       = getDropdownValue('Attach to a Checkbox Modifier')
      const _itemType     = getDropdownValue('Item Type') || getField('Item Type')

      return {
        type: 'default_item',
        heading,
        item_type:             _itemType,
        item_sub_type:         getDropdownValue('Item Sub Type'),
        category:              getDropdownValue('Category'),
        material:              getDropdownValue('Material'),
        formula:               _formula,
        multiplier:            getField('Multiplier'),
        per_li_unit:           getCheckbox('Per LI Unit'),
        include_in_base_price: getCheckbox('Include in Base Price'),
        numeric_modifier:      _numMod,
        checkbox_modifier:     _chkMod,
      }
    }

    if (heading.includes('Dropdown Menu')) {
      return {
        type: 'dropdown_menu',
        heading,
        menu_name:             getField('Menu Name'),
        item:                  getDropdownValue('Item'),
        item_type:             getDropdownValue('Item Type'),
        item_category:         getDropdownValue('Item Category'),
        item_kind:             getDropdownValue('Item Kind'),
        formula:               getDropdownValue('System Formula'),
        charge_per_li_unit:    getCheckbox('Charge Per LI Unit'),
        include_in_base_price: getCheckbox('Include in Base Price'),
        optional:              getCheckbox('This Dropdown Menu is Optional'),
        use_item_per_li_unit:  getCheckbox('Use Item Per LI Unit'),
        percentage_of_base:    getField('Percentage of Base'),
        multiplier:            getField('Multiplier'),
        fixed_quantity:        getField('Fixed Quantity'),
        reference:             getField('Reference'),
        numeric_modifier:      getDropdownValue('Attach to a Numeric Modifier'),
        checkbox_modifier:     getDropdownValue('Attach to a Checkbox Modifier'),
      }
    }

    if (heading.includes('Modifier')) {
      return {
        type: 'modifier',
        heading,
        attribute:     getDropdownValue('Attribute'),
        default_value: getField('DefaultValue') || getField('Default Value'),
        optional:      getCheckbox('This Attribute is Optional'),
      }
    }

    return { type: 'unknown', heading }
  })
}

// Dismiss any open modal and wait for its overlay to fully leave the DOM.
// Safe to call when no modal is open — returns immediately in that case.
// Tries progressively more aggressive dismissal methods, ending with a
// hard DOM removal if nothing else works.
async function closeOpenModal(page) {
  // Fast-path: if no overlay is present at all, nothing to do.
  if (!(await page.$('._ModalOverlay_1tz2y_28'))) return

  const overlayGone = async () => !(await page.$('._ModalOverlay_1tz2y_28'))

  // 1. Click the X button (_button_pckdd_26) inside the modal content wrapper.
  try {
    const xBtn = page.locator('._button_pckdd_26 button, ._button_pckdd_26').first()
    if ((await xBtn.count()) > 0) {
      await xBtn.click({ timeout: 1000, force: true })
      await sleep(300)
      if (await overlayGone()) { await sleep(300); return }
    }
  } catch {}

  // 2. Escape key.
  await page.keyboard.press('Escape')
  await sleep(300)
  if (await overlayGone()) { await sleep(300); return }

  // 3. Cancel/Close button anywhere inside the modal.
  try {
    const cancelBtn = page
      .locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label="Close"]')
      .first()
    if ((await cancelBtn.count()) > 0) {
      await cancelBtn.click({ timeout: 1000, force: true })
      await sleep(300)
      if (await overlayGone()) { await sleep(300); return }
    }
  } catch {}

  // 4. Click the overlay itself at a corner (outside the modal content box).
  try {
    await page.locator('._ModalOverlay_1tz2y_28').click({ timeout: 1000, force: true, position: { x: 10, y: 10 } })
    await sleep(300)
    if (await overlayGone()) { await sleep(300); return }
  } catch {}

  // 5. Hard dismiss: force-remove the overlay node from the DOM.
  await page.evaluate(() => { document.querySelector('._ModalOverlay_1tz2y_28')?.remove() })
  await sleep(500)
  console.log('  WARNING: closeOpenModal — hard DOM removal needed (overlay was stuck)')
}

// Scrape selected items by clicking the plus button on a dropdown menu row.
// Returns string[] of selected item names, or [] on any failure.
async function scrapeDropdownSelectedItems(page, rowLoc, rowIndex) {
  try {
    await closeOpenModal(page)

    const buttons = rowLoc.locator('button')
    if ((await buttons.count()) < 1) return []

    // Step 1: Open the item picker (green plus button at index 0).
    try {
      await buttons.nth(0).scrollIntoViewIfNeeded()
      await buttons.nth(0).click({ timeout: 3000, force: true })
    } catch (e) {
      console.log(`    [DD ${rowIndex}] plus click failed: ${e.message.split('\n')[0]}`)
      return []
    }

    // Step 2: Wait for the picker to appear — "Show Only Selected" label is the signal.
    let showSelectedEl = null
    for (let t = 0; t < 20; t++) {
      await sleep(300)
      const cand = page.locator('button, label, input[type="checkbox"]').filter({ hasText: 'Show Only Selected' })
      if ((await cand.count()) > 0) { showSelectedEl = cand.first(); break }
    }
    if (!showSelectedEl) {
      console.log(`    [DD ${rowIndex}] picker did not appear — 0 selected`)
      await page.keyboard.press('Escape')
      await sleep(300)
      return []
    }

    // Step 3: Before touching "Show Only Selected", load all items. Some
    // pickers paginate — one click can load a batch and then present a
    // NEW "Load N Remaining" for the next batch, so this loops (capped at
    // 10 iterations, matching the retry/load-more loop from the original
    // June 3 implementation of this function that a later DOM-contamination
    // rewrite dropped) rather than assuming a single click always loads
    // everything. Each iteration waits for THIS click's button to clear
    // (up to 10s, not 30s) before checking whether a new one appeared —
    // capped lower than the original per-click wait so a button that
    // changes text instead of disappearing can't stall up to 10x30s.
    let prevLoadText = null
    for (let loadIter = 0; loadIter < 10; loadIter++) {
      const loadRemainingBtn = page.locator('button').filter({ hasText: /load.*remaining/i }).first()
      if ((await loadRemainingBtn.count()) === 0) break
      const loadText = (await loadRemainingBtn.innerText().catch(() => '')).trim()
      if (loadText === prevLoadText) break // same button, didn't advance — stop instead of spinning
      prevLoadText = loadText
      console.log(`    [DD ${rowIndex}] load-more ${loadIter + 1}/10: clicking "${loadText}"…`)
      await loadRemainingBtn.click({ timeout: 5000, force: true }).catch(() => {})
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        await sleep(500)
        if ((await page.locator('button').filter({ hasText: /load.*remaining/i }).count()) === 0) break
      }
      await sleep(500)
    }

    // Step 4: Read the count from "Show Only Selected (N)".
    const labelText = await showSelectedEl.innerText().catch(() => '')
    const countMatch = labelText.match(/\((\d+)\)/)
    const selectedCount = countMatch ? parseInt(countMatch[1], 10) : 0
    console.log(`    [DD ${rowIndex}] "${labelText.trim()}" → count=${selectedCount}`)

    // Step 5: If count is 0, nothing selected — return empty.
    if (selectedCount === 0) {
      await page.keyboard.press('Escape')
      await sleep(300)
      return []
    }

    // Step 5 (count > 0): close and reopen the picker fresh to get a clean DOM
    // with only this picker's items — avoids contamination from previously opened
    // pickers whose cells accumulate in the page DOM across iterations.
    await page.keyboard.press('Escape')
    await sleep(500)

    try {
      await buttons.nth(0).click({ timeout: 3000, force: true })
    } catch (e) {
      console.log(`    [DD ${rowIndex}] reopen click failed: ${e.message.split('\n')[0]}`)
      return []
    }
    await sleep(1000)

    // Click "Show Only Selected" in the freshly opened picker.
    const freshShowSelected = page.locator('button, label, input[type="checkbox"]').filter({ hasText: 'Show Only Selected' }).first()
    await freshShowSelected.click({ timeout: 3000, force: true }).catch(() => {})
    await sleep(1000)

    // Read all name cells and take the last selectedCount — in a fresh picker
    // the only cells present are from this dropdown, so slice(-N) is reliable.
    // Retry up to 3x if the read comes back short of the expected count (the
    // filtered list may not have finished rendering yet) — restores the
    // retry-on-mismatch behavior from the original June 3 implementation of
    // this function, which a later DOM-contamination rewrite dropped in
    // favor of a single read with no retry.
    let items = []
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        console.log(`    [DD ${rowIndex}] retry ${attempt}/2: got ${items.length}, expected ${selectedCount} — re-reading after delay`)
        await sleep(800)
      }
      const allCells = await page.locator('[class*="_contentCell_"][header="Name"]').allInnerTexts()
      items = allCells.map(t => t.trim()).filter(t => t.length > 0).slice(-selectedCount)
      if (items.length >= selectedCount) break
    }
    console.log(`    [DD ${rowIndex}] selected items: ${items.length} (expected ${selectedCount})`)

    // Close the picker.
    await page.keyboard.press('Escape')
    await sleep(300)
    try {
      const closeBtn = page
        .locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label="Close"]')
        .first()
      if ((await closeBtn.count()) > 0) await closeBtn.click({ timeout: 2000, force: true }).catch(() => {})
    } catch {}
    await sleep(300)

    return items
  } catch (e) {
    console.log(`    [DD ${rowIndex}] scrapeDropdownSelectedItems failed: ${e.message.split('\n')[0]}`)
    try { await page.keyboard.press('Escape') } catch {}
    return []
  }
}

// Read grid rows structurally via ShopVOX's own field naming
// (rows[N].xValue, rows[N].items[M].priceInDollars) instead of guessing
// at "reasonable" run-size values or filtering out literal "$0" text —
// both of those heuristics silently dropped real rows (custom run/qty
// sizes like 50 or 3000 that aren't in a hardcoded list, and rows whose
// price genuinely is $0). Only inputs matching this name pattern are
// ever considered, so boilerplate checkboxes/toggles elsewhere on the
// page can't leak in — no value-content filtering needed at all.
async function scrapeGridRowsStructural(page) {
  return page.evaluate(() => {
    const rowRe = /^rows\[(\d+)\]\.xValue$/
    const itemRe = /^rows\[(\d+)\]\.items\[(\d+)\]\.priceInDollars$/
    const rowsByIndex = new Map()

    for (const input of document.querySelectorAll('input[name^="rows["]')) {
      const rowMatch = input.name.match(rowRe)
      if (rowMatch) {
        const idx = Number(rowMatch[1])
        const row = rowsByIndex.get(idx) ?? { xValue: null, items: [] }
        row.xValue = input.value.trim()
        rowsByIndex.set(idx, row)
        continue
      }
      const itemMatch = input.name.match(itemRe)
      if (itemMatch) {
        const idx = Number(itemMatch[1])
        const itemIdx = Number(itemMatch[2])
        const row = rowsByIndex.get(idx) ?? { xValue: null, items: [] }
        row.items[itemIdx] = input.value.trim()
        rowsByIndex.set(idx, row)
      }
    }

    return Array.from(rowsByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, row]) => [row.xValue, ...row.items])
  })
}

// ── Grid pricing scraper ──────────────────────────────────────────────
// SAFETY: only clicks "Show Cost columns" checkbox and finish tab buttons.
// Never touches Grid Type, Fixed Ordering, Export/Import Grid, Add/Delete buttons.
async function scrapeGridPricing(page) {
  // Step 1: Enable "Show Cost columns" only if currently unchecked
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const costLabel = labels.find(l => l.innerText?.trim().includes("Show 'Cost'") || l.innerText?.trim().includes('Show "Cost"'));
    if (costLabel) {
      const cb = costLabel.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) {
        costLabel.click();
      }
    }
  });
  await page.waitForTimeout(1000);

  // Step 2: Find finish tab names scoped to the Finish group only
  const finishTabNames = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const finishHeader = all.find(el =>
      el.tagName === 'SPAN' &&
      el.innerText?.trim() === 'Finish' &&
      el.parentElement?.className?.includes('f-direction-c')
    );
    if (!finishHeader) return [];
    const finishGrandParent = finishHeader.parentElement?.parentElement;
    if (!finishGrandParent) return [];
    const tabs = Array.from(finishGrandParent.querySelectorAll('[class*="_wrapper_p6s6a_1"]'))
      .map(el => el.innerText.trim())
      .filter(t => t.length > 0 && t.length < 30);
    // First element is always the "Finish" section header — skip it
    return tabs.slice(1);
  })

  if (!finishTabNames.length) {
    // Attribute 1 style grid — no finish tabs, rows are named attributes (e.g. "10ft x 10ft")
    console.log('  Grid: no finish tabs — trying Attribute 1 style grid')
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const costLabel = labels.find(l => l.innerText?.trim().includes("Show 'Cost'"));
      if (costLabel) {
        const cb = costLabel.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) costLabel.click();
      }
    });
    await page.waitForTimeout(1000);

    const attrRows = await scrapeGridRowsStructural(page);

    console.log(`  Grid: attribute rows = ${attrRows.length}`)
    return { grid_pricing: { type: 'attribute', rows: attrRows } };
  }
  console.log(`  Grid: finish tabs = ${JSON.stringify(finishTabNames)}`)

  // Step 3: For each finish tab, click and read the pricing grid
  const finishes = {}
  for (const finishName of finishTabNames) {
    // Click finish tab scoped to the Finish group container
    await page.evaluate((tabName) => {
      const all = Array.from(document.querySelectorAll('*'));
      const finishHeader = all.find(el =>
        el.tagName === 'SPAN' &&
        el.innerText?.trim() === 'Finish' &&
        el.parentElement?.className?.includes('f-direction-c')
      );
      const finishGrandParent = finishHeader?.parentElement?.parentElement;
      const tab = finishGrandParent
        ? Array.from(finishGrandParent.querySelectorAll('[class*="_wrapper_p6s6a_1"]'))
            .find(el => el.innerText.trim() === tabName)
        : null;
      if (tab) tab.click();
    }, finishName);
    await page.waitForTimeout(1500);

    // Read grid data structurally (rows[N].xValue / rows[N].items[M].priceInDollars)
    const gridRows = await scrapeGridRowsStructural(page);

    finishes[finishName] = gridRows
    console.log(`  Grid: finish "${finishName}" → ${gridRows.length} rows`)
  }

  return { grid_pricing: { finishes } }
}

// ── Extraction: one product (page.evaluate-only) ──────────────────────
// Every DOM interaction happens inside page.evaluate — no Playwright
// locator strings, no :text-is, no :has. Text-based header matching
// and position-based pencil-button detection are the primitives.
async function extractProduct(page, product, shopvoxUrl) {
  const ROWS_SEL = 'div[aria-roledescription="sortable"]'

  // STEP 1: Navigate and poll for the product to finish loading.
  await page.goto(shopvoxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  let loaded = false
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    const title = await page.title()
    const hasConfig = await page.locator('#product-detail-config').count()
    if (title !== 'shopVOX' && hasConfig > 0) {
      loaded = true
      console.log(`  Loaded in ~${i + 1}s: title="${title}"`)
      break
    }
  }
  if (!loaded) console.log('  WARNING: Product may not have fully loaded')
  console.log('  Page URL:', page.url())

  // Global guard: dismiss any modal overlay left over from a previous product
  // before touching anything on this page.
  await closeOpenModal(page)

  // Make sure we're on Configure Pricing — cheap no-op if already active.
  const cpTab = page.locator('text="Configure Pricing"').first()
  if (await cpTab.count() > 0) {
    await cpTab.click().catch(() => {})
    // Wait for tab content to render before reading any values from it.
    await page.waitForSelector('text="Pricing Settings"', { timeout: 10000 }).catch(() => null)
    await sleep(1000)
  }

  // Guard again after tab switch — tab navigation can occasionally re-trigger
  // a previously open modal in ShopVOX's SPA.
  await closeOpenModal(page)

  // Detect pricing type from the React-Select singleValue element.
  const pricingType = await page.evaluate(() => {
    const singleValue = document.querySelector('[class*="singleValue"]');
    return singleValue?.innerText?.trim() || 'Unknown';
  })
  console.log(`  Pricing type: ${pricingType}`)

  // DEBUG: find exact elements containing pricing type keywords
  const debugPricingType = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    const matches = allEls
      .filter(el => el.children.length === 0 && el.innerText?.trim().match(/^(Grid|Formula|Basic|Pricing Type)$/i))
      .map(el => ({
        tag: el.tagName,
        text: el.innerText.trim(),
        class: el.className?.toString().substring(0,50),
        parentTag: el.parentElement?.tagName,
        parentText: el.parentElement?.innerText?.trim().substring(0,80)
      }));
    return matches.slice(0,10);
  });
  console.log('DEBUG pricing type elements:', JSON.stringify(debugPricingType, null, 2));

  // Read basic pricing fields — always visible on Configure Pricing tab for all product types.
  const basicPricing = await page.evaluate(() => {
    const getInputVal = (labelText) => {
      const wrappers = Array.from(document.querySelectorAll('[class*="_floatingWrapper"], .field-wrapper-container'));
      const wrapper = wrappers.find(w => {
        const label = w.querySelector('label, [class*="_floatingLabel"]');
        return label?.innerText?.trim().replace('*', '').trim() === labelText;
      });
      if (!wrapper) return null;
      const input = wrapper.querySelector('input');
      return input?.value?.trim() || null;
    };

    const getDropdownVal = (labelText) => {
      const wrappers = Array.from(document.querySelectorAll('[class*="_floatingWrapper"], .field-wrapper-container'));
      const wrapper = wrappers.find(w => {
        const label = w.querySelector('label, [class*="_floatingLabel"]');
        return label?.innerText?.trim().replace('*', '').trim() === labelText;
      });
      if (!wrapper) return null;
      const selected = wrapper.querySelector('[class*="singleValue"]');
      if (selected) return selected.innerText?.trim() || null;
      const input = wrapper.querySelector('input, select');
      return input?.value?.trim() || null;
    };

    return {
      buying_cost:         getInputVal('Buying Cost ($)'),
      cost:                getInputVal('Cost ($)'),
      markup:              getInputVal('Markup (X)'),
      price:               getInputVal('Price ($)'),
      units:               getDropdownVal('Units'),
      buying_units:        getDropdownVal('Buying Units'),
      conversion_factor:   getInputVal('Conversion Factor'),
      allow_multiple_qty:  document.querySelector('input[type="checkbox"]')?.checked || false,
    };
  });
  console.log(`  Basic pricing: ${JSON.stringify(basicPricing)}`)

  const parseCells = (t) =>
    t.split(/[\t\n|]+/).map((s) => s.trim()).filter(Boolean)

  // STEP 2/3: Expand a section via Playwright text locator and return the
  // total sortable-row count afterward. Sections are processed in order,
  // so new rows appear at indices [prev_count .. new_count).
  const expandSection = async (sectionName) => {
    // Dismiss any open modal before clicking a section header — the overlay
    // intercepts clicks even on elements outside the modal.
    await closeOpenModal(page)

    // Guard: if a click somehow navigated away from the product page, go back.
    const productPath = shopvoxUrl.split('?')[0]
    if (!page.url().startsWith(productPath)) {
      console.log(`  URL drift before "${sectionName}" (${page.url()}) — navigating back`)
      await page.goto(shopvoxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await sleep(1000)
      await closeOpenModal(page)
    }

    // Find the section header with a short timeout — some products simply don't
    // have all three sections; treat absence as a skip, not a failure.
    const header = page.locator(`text="${sectionName}"`).first()
    try {
      await header.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      console.log(`  Section "${sectionName}" not found — skipping`)
      return null
    }

    try {
      await header.scrollIntoViewIfNeeded()
      await header.click({ timeout: 5000 })
    } catch (e) {
      console.log(`  Section "${sectionName}" click failed: ${e.message.split('\n')[0]} — skipping`)
      return null
    }

    await sleep(1000)
    const total = await page.locator(ROWS_SEL).count()
    console.log(`  ${sectionName}: ${total} total sortable rows after expand`)
    return total
  }

  // STEP 3/4: Click pencil, poll for modal, extract, close.
  const openAndExtractModal = async (rowLoc, buttonIndex, sectionLabel, rowIndex) => {
    // Ensure any lingering modal/overlay from a previous row is fully gone
    // before clicking the pencil — the overlay intercepts all pointer events.
    await closeOpenModal(page)

    const buttons = rowLoc.locator('button')
    const btnCount = await buttons.count()
    console.log(`  ${sectionLabel} row ${rowIndex}: ${btnCount} buttons`)
    if (btnCount <= buttonIndex) return null

    try {
      await buttons.nth(buttonIndex).scrollIntoViewIfNeeded()
      // { force: true } bypasses Playwright's actionability checks (e.g.
      // "element is hidden by overlay") which were blocking the click.
      await buttons.nth(buttonIndex).click({ timeout: 3000, force: true })
    } catch (e) {
      console.log(`    click failed: ${e.message.split('\n')[0]}`)
      await closeOpenModal(page)
      return null
    }

    // Poll up to 15s for Edit modal heading. Try specific _ModalContent_1tz2y_44
    // selectors in order — the generic h2/h3 locator was missing the heading
    // when it lives inside the scoped modal content wrapper.
    let heading = null
    for (let t = 0; t < 50; t++) {
      await sleep(300)
      heading = await page.evaluate(() => {
        const SELECTORS = [
          '._ModalContent_1tz2y_44 h1',
          '._ModalContent_1tz2y_44 h2',
          '._ModalContent_1tz2y_44 h3',
          '._ModalContent_1tz2y_44 [class*="heading"]',
          '._ModalContent_1tz2y_44 [class*="title"]',
        ]
        for (const sel of SELECTORS) {
          const el = document.querySelector(sel)
          if (el) {
            const t = (el.innerText || '').trim()
            if (t) return t
          }
        }
        // Fallback: first shallow element inside modal content whose text starts with "Edit"
        const content = document.querySelector('._ModalContent_1tz2y_44')
        if (content) {
          const el = Array.from(content.querySelectorAll('*')).find(
            (e) => (e.innerText || '').trim().startsWith('Edit') && e.children.length <= 3
          )
          if (el) return (el.innerText || '').trim().split('\n')[0].trim()
        }
        return null
      })
      if (heading) break
    }
    console.log(`  Modal heading: ${heading || 'NOT FOUND'}`)
    if (!heading) {
      // Dump whatever is in the modal container so we can iterate on
      // either the heading detection or the close logic offline.
      const modalHtml = await page.evaluate(() => {
        const m = document.querySelector('[id*="modal"], [class*="modal"], [class*="Modal"]')
        return m ? m.innerHTML.substring(0, 500) : 'no modal found'
      })
      console.log('  Modal HTML preview:', modalHtml)
      await closeOpenModal(page)
      return null
    }

    // Wrap extraction in try/catch — if it times out, close and continue to
    // the next row rather than aborting the whole product.
    let fields = null
    try {
      fields = await extractModalFields(page)
    } catch (e) {
      console.log(`    extractModalFields failed: ${e.message.split('\n')[0]}`)
    }
    // Always close after each modal, and wait for overlay to clear before
    // the next pencil click.
    await closeOpenModal(page)
    return fields
  }

  // SECTIONS — Grid products use scrapeGridPricing(); others expand the three sections.
  let modifiers = []
  let dropdown_menus = []
  let default_items = []
  const pricing = { pricing_type: pricingType, ...basicPricing }

  if (pricingType === 'Grid') {
    console.log('  Skipping Modifiers/Dropdown Menus/Default Items — Grid pricing product')
    const gridResult = await scrapeGridPricing(page)
    pricing.grid_pricing = gridResult.grid_pricing
  } else {
    // Row-index tracking: sections render sequentially, so the rows added
    // by this expand are at indices [offset .. countAfterExpand).
    let offset = 0

    // 3a. Modifiers — buttons: [0]=pencil, [1]=delete (disabled), [2]=drag
    const afterMod = await expandSection('Modifiers')
    if (afterMod != null) {
      for (let i = offset; i < afterMod; i++) {
        const row = page.locator(ROWS_SEL).nth(i)
        const text = (await row.innerText()).trim()
        const c = parseCells(text)
        const base = { name: c[0] ?? null, type: c[1] ?? null, default: c[2] ?? null, raw: text }
        base.modal = await openAndExtractModal(row, 0, 'Modifiers', i)
        modifiers.push(base)
      }
      offset = afterMod
    }

    // 3b. Dropdown Menus (green + at index 0, pencil at index 1)
    // Per row: pencil → flatten modal fields to top level; plus → selected items.
    const afterDD = await expandSection('Dropdown Menus')
    if (afterDD != null) {
      for (let i = offset; i < afterDD; i++) {
        const row = page.locator(ROWS_SEL).nth(i)
        const text = (await row.innerText()).trim()
        const c = parseCells(text)

        // Pencil (button 1) — edit modal with all config fields
        const modal = await openAndExtractModal(row, 1, 'Dropdown Menus', i)

        // Plus (button 0) — item picker to scrape selected items
        const selected_items = await scrapeDropdownSelectedItems(page, row, i)

        // Flatten modal fields to top level (no nested modal key).
        // numeric_modifier → attach_num_modifier, checkbox_modifier → attach_chk_modifier.
        dropdown_menus.push({
          menu_name:             c[0] ?? null,
          item_type:             c[1] ?? null,
          category:              c[2] ?? null,
          reference:             modal?.reference ?? null,
          formula:               modal?.formula ?? null,
          multiplier:            modal?.multiplier ?? null,
          fixed_quantity:        modal?.fixed_quantity ?? null,
          percentage_of_base:    modal?.percentage_of_base ?? null,
          charge_per_li_unit:    modal?.charge_per_li_unit ?? null,
          include_in_base_price: modal?.include_in_base_price ?? null,
          optional:              modal?.optional ?? null,
          use_item_per_li_unit:  modal?.use_item_per_li_unit ?? null,
          attach_num_modifier:   modal?.numeric_modifier ?? null,
          attach_chk_modifier:   modal?.checkbox_modifier ?? null,
          selected_items,
          raw: text,
        })
      }
      offset = afterDD
    }

    // 3c. Default Items (no green + — pencil is at index 0)
    const afterDI = await expandSection('Default Items')
    if (afterDI != null) {
      for (let i = offset; i < afterDI; i++) {
        const row = page.locator(ROWS_SEL).nth(i)
        const text = (await row.innerText()).trim()
        const c = parseCells(text)
        const base = { name: c[0] ?? null, item_type: c[1] ?? null, raw: text }
        base.modal = await openAndExtractModal(row, 0, 'Default Items', i)
        default_items.push(base)
      }
      offset = afterDI
    }
  }

  // First-product verification: dump expanded HTML + log all extractions.
  if (firstProduct) {
    firstProduct = false
    if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true })
    const htmlPath = resolve(DEBUG_DIR, 'product-detail-expanded.html')
    writeFileSync(htmlPath, await page.content(), 'utf8')
    console.log(`\n  First-product expanded HTML → ${htmlPath}`)
    console.log(`  Extracted (first product):`)
    console.log(`    pricing_type: ${pricingType}`)
    if (pricingType === 'Grid') {
      const finishes = pricing.grid_pricing?.finishes ?? {}
      for (const [name, rows] of Object.entries(finishes))
        console.log(`    grid finish "${name}": ${rows.length} rows`)
    } else {
      console.log(`    modifiers (${modifiers.length}):`)
      for (const m of modifiers) console.log(`      ${JSON.stringify(m)}`)
      console.log(`    dropdown_menus (${dropdown_menus.length}):`)
      for (const d of dropdown_menus) console.log(`      ${JSON.stringify(d)}`)
      console.log(`    default_items (${default_items.length}):`)
      for (const di of default_items) console.log(`      ${JSON.stringify(di)}`)
    }
  }

  return { pricing, modifiers, dropdown_menus, default_items }
}

// ── Save back to DB ───────────────────────────────────────────────────
async function saveToDb(product, extracted) {
  const existing = product.shopvox_data || {}
  const mergedPricing = { ...(existing.pricing ?? {}), ...extracted.pricing }
  // Drop nulls we failed to read so existing CSV values win over scraped nulls.
  for (const k of Object.keys(mergedPricing)) if (mergedPricing[k] == null || mergedPricing[k] === '') delete mergedPricing[k]

  // Merge dropdown_menus: spread existing entry first, then new scraped entry on top.
  // This preserves selected_items (and any other fields) from previous browser-extract
  // runs while adding/updating the modal fields captured in this Playwright run.
  // Matching is case-insensitive and handles both menu_name and 'Menu Name' key formats.
  const getMenuKey = (e) => ((e.menu_name || e['Menu Name']) ?? '').toLowerCase().trim()
  const existingDDs = existing.dropdown_menus || []
  const existingDDMap = new Map(existingDDs.map(e => [getMenuKey(e), e]))

  const mergedDDs = extracted.dropdown_menus.map(entry => {
    const existingEntry = existingDDMap.get(getMenuKey(entry))
    return existingEntry ? { ...existingEntry, ...entry } : entry
  })
  // Preserve any existing entries the new scrape didn't touch (e.g. scrape was partial).
  const scrapedKeys = new Set(extracted.dropdown_menus.map(getMenuKey))
  for (const e of existingDDs) {
    if (!scrapedKeys.has(getMenuKey(e))) mergedDDs.push(e)
  }

  const promotedDefaultItems = extracted.default_items.map((item) => ({
    ...item,
    per_li_unit: item.modal?.per_li_unit ?? null,
    formula:     item.modal?.formula     ?? null,
    multiplier:  item.modal?.multiplier  ?? null,
  }))

  const next = {
    ...existing,
    pricing: { ...(existing.pricing ?? {}), ...mergedPricing },
    modifiers: extracted.modifiers,
    dropdown_menus: mergedDDs,
    default_items: promotedDefaultItems,
    extracted_at: new Date().toISOString(),
    extraction_version: 2,
  }
  const { error } = await sb.from('products').update({ shopvox_data: next }).eq('id', product.id)
  if (error) throw new Error(`DB update: ${error.message}`)
}

// ── Browser setup ─────────────────────────────────────────────────────
async function launchBrowser() {
  if (CDP_URL) {
    console.log(`Connecting to Chrome via CDP: ${CDP_URL}`)
    const browser = await chromium.connectOverCDP(CDP_URL)
    const contexts = browser.contexts()
    const context = contexts[0] ?? await browser.newContext()
    return { browser, context, isPersistent: false }
  }
  // Remove stale lock files that prevent Chrome from re-attaching to the session
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
  return { browser: null, context, isPersistent: true }
}

async function ensureLoggedIn(page) {
  // Kick-start navigation — best-effort. If the user isn't logged in this
  // lands on the login screen; if they are, they see the products list.
  // Either way we defer to the user to confirm readiness via ENTER.
  // waitUntil: 'domcontentloaded' (not 'networkidle') because Angular apps
  // often keep a live connection and never go idle.
  await page
    .goto(URLS.products, { timeout: 30000, waitUntil: 'domcontentloaded' })
    .catch(() => {})

  console.log('\n────────────────────────────────────────────────────────')
  console.log('  MANUAL STEP — in the open Chromium window:')
  console.log('    1. Log into ShopVOX if not already logged in')
  console.log(`    2. Navigate to ${URLS.products}`)
  console.log('    3. Click "Load All" so every product row is visible')
  console.log('    4. Confirm the product list is fully rendered')
  console.log('  Then press ENTER here to continue.')
  console.log('  (No timeout — the script will wait as long as you need.')
  console.log('   The browser will stay open until you press ENTER.)')
  console.log('────────────────────────────────────────────────────────\n')

  // Wait FOREVER for ENTER. No race, no timeout wrapper, no browser
  // interaction — nothing can close the script or the browser here.
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  await new Promise((resolve) => process.stdin.once('data', () => resolve()))
  process.stdin.pause()

  // Only now — AFTER ENTER — do we touch the browser again. Capture a
  // diagnostic snapshot so if selector detection fails we can inspect
  // the real DOM offline.
  if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true })
  const shotPath = resolve(DEBUG_DIR, 'products-list.png')
  const htmlPath = resolve(DEBUG_DIR, 'products-list.html')
  try { await page.screenshot({ path: shotPath, fullPage: true }) } catch (e) { console.log(`  (screenshot failed: ${e.message})`) }
  try { writeFileSync(htmlPath, await page.content(), 'utf8') } catch (e) { console.log(`  (HTML dump failed: ${e.message})`) }
  console.log(`  Saved snapshot → ${shotPath}`)
  console.log(`  Saved HTML     → ${htmlPath}`)

  // Confirmed selector from the live HTML dump — 752 rows on a single page.
  try {
    await page.waitForSelector(SELECTORS.productListRow, { timeout: 15000, state: 'visible' })
  } catch {
    console.error('\n✗ Could not find product list — check shopvox-debug/products-list.html')
    try { await page.context().close() } catch {}
    process.exit(1)
  }
  console.log(`  Product list selector matched: ${SELECTORS.productListRow}`)
}

// ── Main ──────────────────────────────────────────────────────────────
// ShopVOX drives the loop: we scrape URLs from the list page, then for
// each URL look up the matching PrintOS row (by shopvox_data.id → name).
// Matched rows get updated; unmatched ShopVOX products still get
// extracted and written to shopvox-extract-orphans.json.
async function main() {
  const startAt = Date.now()

  const { browser, context, isPersistent } = await launchBrowser()
  const page = context.pages()[0] ?? await context.newPage()

  // Forward browser console.log calls to the Node terminal so diagnostics
  // emitted from inside page.evaluate (button inventories, modal heading)
  // show up in the script's output.
  page.on('console', (msg) => {
    if (msg.type() === 'log') {
      console.log('  BROWSER:', msg.text())
    }
  })

  await ensureLoggedIn(page)

  // --debug --limit 1 skips URL collection entirely and tests against a
  // known-good Banner product. Saves time during selector iteration.
  let shopvoxProducts
  if (DEBUG && LIMIT === 1) {
    const TEST_URL  = 'https://express.shopvox.com/settings/products/a2adac04-caa0-40f3-a57e-a9c2e412a580'
    const TEST_NAME = 'Vinyl Regular- Digital'
    const TEST_UUID = 'a2adac04-caa0-40f3-a57e-a9c2e412a580'
    console.log(`DEBUG MODE: Using hardcoded test URL: ${TEST_NAME}`)
    shopvoxProducts = [{ url: TEST_URL, name: TEST_NAME, shopvoxId: TEST_UUID }]
  } else {
    console.log('Collecting ShopVOX product URLs from list page…')
    shopvoxProducts = await collectAllProductUrls(page)
    if (shopvoxProducts.length === 0) {
      throw new Error('Collected 0 product URLs — check SELECTORS.productListLink.')
    }
  }

  // --limit / --product filter the ShopVOX list directly.
  let toExtract = shopvoxProducts
  if (ONLY_PRODUCT) {
    const needle = ONLY_PRODUCT.toLowerCase()
    toExtract = toExtract.filter((sv) => (sv.name || '').toLowerCase().includes(needle))
  }
  if (LIMIT) toExtract = toExtract.slice(0, LIMIT)
  console.log(`Extracting ${toExtract.length} of ${shopvoxProducts.length} ShopVOX products…`)

  let success = 0, skipped = 0, failed = 0, orphanCount = 0
  let loggedFirstMatch = false

  for (let i = 0; i < toExtract.length; i++) {
    const sv = toExtract[i]
    const label = `${i + 1}/${toExtract.length}  "${sv.name}" (${sv.shopvoxId})`
    const progressKey = sv.shopvoxId || sv.name // progress tracked per ShopVOX id

    // Supabase lookup
    let match = null
    try {
      match = await lookupPrintOSProduct(sv)
    } catch (e) {
      console.log(`  LOOKUP-FAIL  ${label}  ${e.message}`)
    }
    const printosProduct = match?.product ?? null

    // First-Supabase-match diagnostic — shows which shopvox_data fields
    // are actually populated on matched products.
    if (!loggedFirstMatch && printosProduct) {
      loggedFirstMatch = true
      console.log(`  First Supabase match: ShopVOX "${sv.name}" (${sv.shopvoxId})`)
      console.log(`    → PrintOS ${printosProduct.id} "${printosProduct.name}"  (by ${match.matchedBy})`)
      console.log(`    shopvox_data: ${JSON.stringify(printosProduct.shopvox_data, null, 2)}`)
    }

    // Skip / re-queue — keyed by ShopVOX id, gated on matched product's DB state.
    if (DEBUG && progress.done[progressKey]) {
      console.log(`  DEBUG re-extract  ${label}  (was done ${progress.done[progressKey]})`)
      delete progress.done[progressKey]
    } else if (RESUME && progress.done[progressKey]) {
      if (printosProduct && hasRealRecipeData(printosProduct.shopvox_data)) {
        skipped++
        console.log(`  SKIP  ${label}  (already done ${progress.done[progressKey]})`)
        continue
      }
      console.log(`  RE-QUEUE  ${label} — previous extract had no recipe data`)
      delete progress.done[progressKey]
    }

    // Extract
    process.stdout.write(`  EXTRACTING  ${label}… `)
    const productStart = Date.now()
    console.log('Calling extractProduct with url:', sv.url)
    try {
      // extractProduct needs something with .id / .name for screenshots and logs
      const extractContext = printosProduct || {
        id:   sv.shopvoxId || sv.name,
        name: sv.name,
        shopvox_data: null,
      }
      // Sanity check: never ship a URL with literal "undefined" in the path.
      if (!sv.url || /\/undefined(?:\/|$)/i.test(sv.url)) {
        throw new Error(`invalid shopvoxUrl: ${sv.url}`)
      }
      const extracted = await Promise.race([
        extractProduct(page, extractContext, sv.url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 300s')), 300000)),
      ])
      const ms = Date.now() - productStart
      if (printosProduct) {
        await saveToDb(printosProduct, extracted)
        console.log(`OK (${ms}ms, mods=${extracted.modifiers.length}, dd=${extracted.dropdown_menus.length}, items=${extracted.default_items.length})`)
      } else {
        orphans.orphans.push({
          shopvoxId: sv.shopvoxId,
          shopvoxName: sv.name,
          shopvoxUrl: sv.url,
          extractedAt: new Date().toISOString(),
          data: extracted,
        })
        saveJson(ORPHANS_FILE, orphans)
        orphanCount++
        console.log(`ORPHAN (${ms}ms, mods=${extracted.modifiers.length}, dd=${extracted.dropdown_menus.length}, items=${extracted.default_items.length})`)
      }
      progress.done[progressKey] = new Date().toISOString()
      saveJson(PROGRESS_FILE, progress)
      success++
    } catch (e) {
      const msg = e?.message ?? String(e)
      console.log(`FAIL  ${msg}`)
      await screenshot(page, `ERR_${sv.shopvoxId || 'noid'}`)
      errors.errors.push({ shopvoxId: sv.shopvoxId, name: sv.name, url: sv.url, error: msg, at: new Date().toISOString() })
      saveJson(ERRORS_FILE, errors)
      failed++
    }

    // Throttle
    await sleep(1000)
    if ((i + 1) % 50 === 0) await sleep(3000)
  }

  if (DEBUG) {
    console.log('DEBUG: Browser staying open for inspection. Press ENTER to close.')
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    await new Promise((resolve) => process.stdin.once('data', () => resolve()))
    process.stdin.pause()
  }

  if (isPersistent) await context.close()
  else if (browser) await browser.close()

  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1)
  const avg = success > 0 ? ((Date.now() - startAt) / 1000 / success).toFixed(1) : '—'
  console.log('\n──────────────── Summary ────────────────')
  console.log(`  ShopVOX products on page: ${shopvoxProducts.length}`)
  console.log(`  Attempted:                ${toExtract.length}`)
  console.log(`  Successfully extracted:   ${success}`)
  console.log(`  Skipped (already done):   ${skipped}`)
  console.log(`  Orphans (no PrintOS row): ${orphanCount}`)
  console.log(`  Failed:                   ${failed}`)
  console.log(`  Elapsed:                  ${elapsed}s`)
  console.log(`  Avg per product:          ${avg}s`)
  if (failed > 0)      console.log(`  → Errors:  ${ERRORS_FILE}`)
  if (orphanCount > 0) console.log(`  → Orphans: ${ORPHANS_FILE}`)
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })

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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
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
  const dropdownBtn = page
    .locator(`div[aria-haspopup="dialog"] button:has-text("${currentView}")`)
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
    const modal = Array.from(document.querySelectorAll('div')).find((d) => {
      const h = d.querySelector('h2, h3, h4')
      return h && (h.innerText || '').includes('Edit')
    })
    console.log('Modal element:', modal?.className)
    if (!modal) return null

    const getField = (labelText) => {
      const allEls = Array.from(modal.querySelectorAll('*'))
      const label = allEls.find(
        (el) => (el.innerText || '').trim() === labelText && el.children.length <= 2,
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
      const label = cands.find((el) => (el.innerText || '').trim() === labelText)
      if (!label) return false
      const cb =
        label.closest('div')?.querySelector('input[type="checkbox"]') ||
        label.previousElementSibling?.querySelector('input[type="checkbox"]') ||
        label.querySelector('input[type="checkbox"]')
      return cb ? !!cb.checked : false
    }

    const getDropdownValue = (labelText) => {
      const allEls = Array.from(modal.querySelectorAll('*'))
      const label = allEls.find(
        (el) => (el.innerText || '').trim() === labelText && el.tagName !== 'OPTION',
      )
      if (!label) return null
      const container =
        label.closest('div[class*="select"], div[class*="dropdown"]') ||
        label.parentElement?.parentElement
      if (!container) return null
      const displayed = container.querySelector('[class*="value"], [class*="selected"]')
      if (displayed) return (displayed.innerText || '').trim()
      const select = container.querySelector('select')
      if (select) return select.options[select.selectedIndex]?.text
      return null
    }

    const heading = (modal.querySelector('h2, h3, h4')?.innerText || '').trim()
    console.log('Modal heading found:', heading)

    if (heading.includes('Default Item')) {
      return {
        type: 'default_item',
        heading,
        item_type:             getDropdownValue('Item Type') || getField('Item Type'),
        item_sub_type:         getDropdownValue('Item Sub Type'),
        category:              getDropdownValue('Category'),
        material:              getDropdownValue('Material'),
        formula:               getDropdownValue('Formula') || getDropdownValue('System Formula'),
        multiplier:            getField('Multiplier'),
        per_li_unit:           getCheckbox('Per LI Unit'),
        include_in_base_price: getCheckbox('Include in Base Price'),
        numeric_modifier:      getDropdownValue('Attach to a Numeric Modifier'),
        checkbox_modifier:     getDropdownValue('Attach to a Checkbox Modifier'),
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

// Close the currently-open modal by clicking its Cancel button.
async function closeOpenModal(page) {
  await page.keyboard.press('Escape')
  await sleep(500)
  // Wait for the modal overlay to actually disappear so the next pencil
  // click doesn't hit the overlay instead of the intended button.
  await page
    .waitForSelector('._ModalOverlay_1tz2y_28', { state: 'hidden', timeout: 3000 })
    .catch(() => {})
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

  // Make sure we're on Configure Pricing — cheap no-op if already active.
  const cpTab = page.locator('text="Configure Pricing"').first()
  if (await cpTab.count() > 0) {
    await cpTab.click().catch(() => {})
    await sleep(1000)
  }

  const parseCells = (t) =>
    t.split(/[\t\n|]+/).map((s) => s.trim()).filter(Boolean)

  // STEP 2/3: Expand a section via Playwright text locator and return the
  // total sortable-row count afterward. Sections are processed in order,
  // so new rows appear at indices [prev_count .. new_count).
  const expandSection = async (sectionName) => {
    const header = page.locator(`text="${sectionName}"`).first()
    if ((await header.count()) === 0) {
      console.log(`  No "${sectionName}" header found`)
      return null
    }
    await header.scrollIntoViewIfNeeded()
    await header.click()
    await sleep(2000)
    const total = await page.locator(ROWS_SEL).count()
    console.log(`  ${sectionName}: ${total} total sortable rows after expand`)
    return total
  }

  // STEP 3/4: Click pencil, poll for modal, extract, close.
  const openAndExtractModal = async (rowLoc, buttonIndex, sectionLabel, rowIndex) => {
    // Force-close any lingering modal/overlay from a previous row before
    // attempting the next click. Escape handles keyboard-dismissible modals;
    // if that misses, clicking the overlay element itself dismisses it.
    await page.keyboard.press('Escape')
    await sleep(300)
    await page.evaluate(() => {
      const overlay = document.querySelector('._ModalOverlay_1tz2y_28')
      if (overlay) overlay.click()
    })
    await sleep(300)

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
      // First line only — Playwright click errors are verbose multi-line.
      console.log(`    click failed: ${e.message.split('\n')[0]}`)
      return null
    }

    // Poll up to 3s for Edit modal heading.
    const modalHeading = page.locator('h2, h3, h4').filter({ hasText: 'Edit' }).first()
    let heading = null
    for (let t = 0; t < 15; t++) {
      await sleep(200)
      if ((await modalHeading.count()) > 0) {
        heading = (await modalHeading.innerText()).trim()
        break
      }
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
      return null
    }

    const fields = await extractModalFields(page)
    await closeOpenModal(page)
    return fields
  }

  // SECTIONS — expand one, process all its rows, then next.
  // Row-index tracking: sections render sequentially, so the rows added
  // by this expand are at indices [offset .. countAfterExpand).
  let offset = 0
  const modifiers = []
  const dropdown_menus = []
  const default_items = []

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
  const afterDD = await expandSection('Dropdown Menus')
  if (afterDD != null) {
    for (let i = offset; i < afterDD; i++) {
      const row = page.locator(ROWS_SEL).nth(i)
      const text = (await row.innerText()).trim()
      const c = parseCells(text)
      const base = { menu_name: c[0] ?? null, item_type: c[1] ?? null, category: c[2] ?? null, raw: text }
      base.modal = await openAndExtractModal(row, 1, 'Dropdown Menus', i)
      dropdown_menus.push(base)
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

  // First-product verification: dump expanded HTML + log all extractions.
  if (firstProduct) {
    firstProduct = false
    if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true })
    const htmlPath = resolve(DEBUG_DIR, 'product-detail-expanded.html')
    writeFileSync(htmlPath, await page.content(), 'utf8')
    console.log(`\n  First-product expanded HTML → ${htmlPath}`)
    console.log(`  Extracted (first product):`)
    console.log(`    modifiers (${modifiers.length}):`)
    for (const m of modifiers) console.log(`      ${JSON.stringify(m)}`)
    console.log(`    dropdown_menus (${dropdown_menus.length}):`)
    for (const d of dropdown_menus) console.log(`      ${JSON.stringify(d)}`)
    console.log(`    default_items (${default_items.length}):`)
    for (const di of default_items) console.log(`      ${JSON.stringify(di)}`)
  }

  return { pricing: {}, modifiers, dropdown_menus, default_items }
}

// ── Save back to DB ───────────────────────────────────────────────────
async function saveToDb(product, extracted) {
  // Merge — preserve existing fields (basic, pricing already populated by CSV extractor).
  const existing = product.shopvox_data || {}
  const mergedPricing = { ...(existing.pricing ?? {}), ...extracted.pricing }
  // Drop nulls we failed to read so existing CSV values win over scraped nulls.
  for (const k of Object.keys(mergedPricing)) if (mergedPricing[k] == null || mergedPricing[k] === '') delete mergedPricing[k]
  const next = {
    ...existing,
    pricing: { ...(existing.pricing ?? {}), ...mergedPricing },
    modifiers: extracted.modifiers,
    dropdown_menus: extracted.dropdown_menus,
    default_items: extracted.default_items,
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
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 90s')), 90000)),
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

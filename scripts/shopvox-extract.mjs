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

if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })
if (DEBUG && !existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true })

function loadJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
function saveJson(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2)) }

const progress = RESUME ? loadJson(PROGRESS_FILE, { done: {}, started_at: new Date().toISOString() }) : { done: {}, started_at: new Date().toISOString() }
const errors   = loadJson(ERRORS_FILE,   { errors: [] })

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
  // Log-in detection — anything on ShopVOX that only shows when logged in.
  // After login the URL should stay on /settings/* rather than redirect to /login.
  loggedOutUrlPattern: /\/login|\/sign[- ]?in/i,

  // Search on the Products settings page
  searchInput: 'input[placeholder*="Search" i]',

  // First row in the results table after searching — adjust to your DOM
  firstProductRow: 'table tbody tr:first-child a, table tbody tr:first-child [role="link"]',

  // Tab inside a product's edit view
  configurePricingTab: 'role=tab[name=/configure pricing/i]',

  // Pricing summary inputs (values read via locator().inputValue())
  pricingTypeSelect: 'select[name="pricing_type"], [aria-label="Pricing Type"]',
  formulaSelect:     'select[name="formula"], [aria-label="Formula"]',
  pricingMethodSelect: 'select[name="pricing_method"], [aria-label="Pricing Method"]',
  buyingUnitsSelect: 'select[name="buying_units"], [aria-label="Buying Units"]',
  minLinePriceInput: 'input[name="minimum_line_price"], [aria-label="Minimum Line Price"]',
  minUnitPriceInput: 'input[name="minimum_unit_price"], [aria-label="Minimum Unit Price"]',
  volumeDiscountSelect: 'select[name="volume_discount"], [aria-label="Volume Discount"]',
  rangeDiscountSelect:  'select[name="range_discount"], [aria-label="Range Discount"]',

  // Collapsible section headers — clicking toggles
  modifiersHeader:     'role=button[name=/modifiers/i]',
  dropdownMenusHeader: 'role=button[name=/dropdown menus/i]',
  defaultItemsHeader:  'role=button[name=/default items/i]',

  // Modifiers table rows inside the expanded section
  modifierRow: '[data-section="modifiers"] tbody tr',

  // Dropdown menus
  dropdownMenuRow: '[data-section="dropdown-menus"] tbody tr',
  dropdownAddItemsButton: 'button[aria-label*="add items" i], button:has(svg[aria-label="plus"])',
  showOnlySelectedCheckbox: 'label:has-text("Show Only Selected Items") input',
  dialogCancel: 'role=button[name=/cancel|close/i]',

  // Default items
  defaultItemRow: '[data-section="default-items"] tbody tr',
  defaultItemEditButton: 'button[aria-label*="edit" i], button:has(svg[aria-label="pencil"])',
  defaultItemDialog: 'role=dialog',
  defaultItemCloseButton: 'role=button[name=/cancel|close/i]',
}

// ── Helpers ───────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const normName = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()

async function screenshot(page, label) {
  if (!DEBUG) return
  const safe = label.replace(/[^\w-]+/g, '_').slice(0, 80)
  const path = resolve(DEBUG_DIR, `${Date.now()}_${safe}.png`)
  try { await page.screenshot({ path, fullPage: true }) } catch {}
}

async function readInputValue(page, selector) {
  try {
    const loc = page.locator(selector).first()
    if (await loc.count() === 0) return null
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => null)
    if (tag === 'select') {
      return await loc.evaluate((el) => {
        const opt = el.options[el.selectedIndex]
        return opt ? opt.textContent?.trim() ?? opt.value : null
      }).catch(() => null)
    }
    return (await loc.inputValue().catch(() => null))
  } catch { return null }
}

async function isCheckboxChecked(page, selectorOrLocator) {
  try {
    const loc = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator).first() : selectorOrLocator
    if (await loc.count() === 0) return false
    return await loc.isChecked().catch(() => false)
  } catch { return false }
}

// ── Supabase: fetch pending products ──────────────────────────────────
async function fetchPendingProducts() {
  // Pull all products for the org that claim shopvox_reference but have no modifiers extracted yet.
  const pageSize = 1000
  const out = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from('products')
      .select('id, name, shopvox_data, migration_status')
      .eq('organization_id', ORG_ID)
      .order('name')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Fetch: ${error.message}`)
    out.push(...(data ?? []))
    if ((data ?? []).length < pageSize) break
  }
  return out.filter((p) => {
    const sv = p.shopvox_data || {}
    const hasRecipe = Array.isArray(sv.default_items) && sv.default_items.length > 0
    const hasMods = Array.isArray(sv.modifiers) && sv.modifiers.length > 0
    if (hasRecipe || hasMods) return false                 // already deeply extracted
    if (p.migration_status !== 'shopvox_reference') return false
    if (ONLY_PRODUCT) return p.name.toLowerCase().includes(ONLY_PRODUCT.toLowerCase())
    return true
  })
}

// ── Extraction: one product ───────────────────────────────────────────
async function extractProduct(page, product) {
  // 1. Navigate
  await page.goto(URLS.products, { waitUntil: 'domcontentloaded' })
  await sleep(800)
  await screenshot(page, `01-products-${product.id}`)

  // 2. Search
  const search = page.locator(SELECTORS.searchInput).first()
  if (await search.count() === 0) throw new Error('Search input not found on /settings/products')
  // Try name, then first 30 chars, then first two words
  const candidates = [
    product.name,
    product.name.slice(0, 30),
    product.name.split(/\s+/).slice(0, 2).join(' '),
  ].map((s) => s.trim()).filter((s, i, arr) => s && arr.indexOf(s) === i)

  let foundRow = null
  for (const q of candidates) {
    await search.fill('')
    await search.type(q, { delay: 30 })
    await sleep(1500)
    await screenshot(page, `02-search-${q}`)
    const rows = page.locator(SELECTORS.firstProductRow)
    if (await rows.count() > 0) { foundRow = rows.first(); break }
  }
  if (!foundRow) throw new Error(`No search result for "${product.name}"`)

  if (INSPECT) {
    console.log('\n⏸ --inspect: paused after search. Check DevTools, then resume in the node REPL (Ctrl+C to exit).')
    await page.pause()
  }

  await foundRow.click()
  await page.waitForLoadState('domcontentloaded')
  await sleep(1500)
  await screenshot(page, `03-product-page-${product.id}`)

  // 3. Configure Pricing tab
  const cpTab = page.locator(SELECTORS.configurePricingTab).first()
  if (await cpTab.count() > 0) {
    await cpTab.click().catch(() => {})
    await sleep(1500)
  }
  await screenshot(page, `04-configure-pricing-${product.id}`)

  // 4. Pricing settings
  const pricing = {
    pricing_type: await readInputValue(page, SELECTORS.pricingTypeSelect),
    formula: await readInputValue(page, SELECTORS.formulaSelect),
    pricing_method: await readInputValue(page, SELECTORS.pricingMethodSelect),
    buying_units: await readInputValue(page, SELECTORS.buyingUnitsSelect),
    minimum_line_price: await readInputValue(page, SELECTORS.minLinePriceInput),
    minimum_unit_price: await readInputValue(page, SELECTORS.minUnitPriceInput),
    volume_discount: await readInputValue(page, SELECTORS.volumeDiscountSelect),
    range_discount: await readInputValue(page, SELECTORS.rangeDiscountSelect),
  }

  // 5. Modifiers
  await clickIfExists(page, SELECTORS.modifiersHeader)
  await sleep(1000)
  await screenshot(page, `05-modifiers-expanded-${product.id}`)
  const modifiers = await extractModifiers(page)

  // 6. Dropdown Menus
  await clickIfExists(page, SELECTORS.dropdownMenusHeader)
  await sleep(1000)
  await screenshot(page, `06-dropdown-menus-${product.id}`)
  const dropdown_menus = await extractDropdownMenus(page)

  // 7. Default Items
  await clickIfExists(page, SELECTORS.defaultItemsHeader)
  await sleep(1000)
  await screenshot(page, `07-default-items-${product.id}`)
  const default_items = await extractDefaultItems(page)

  return { pricing, modifiers, dropdown_menus, default_items }
}

async function clickIfExists(page, selector) {
  const loc = page.locator(selector).first()
  if (await loc.count() > 0) {
    await loc.click().catch(() => {})
    return true
  }
  return false
}

async function extractModifiers(page) {
  const rows = page.locator(SELECTORS.modifierRow)
  const n = await rows.count()
  const out = []
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    const cells = row.locator('td')
    const cellCount = await cells.count()
    if (cellCount === 0) continue
    const texts = []
    for (let c = 0; c < cellCount; c++) texts.push((await cells.nth(c).innerText().catch(() => '')).trim())
    // Best-effort mapping — adjust indexes based on actual DOM
    // Assumed column order: [name, type, default, units, in_use]
    out.push({
      name: texts[0] ?? null,
      type: texts[1] ?? null,
      default: texts[2] ?? null,
      in_use: /yes|true/i.test(texts[texts.length - 1] ?? ''),
      _raw_cells: DEBUG ? texts : undefined,
    })
  }
  return out
}

async function extractDropdownMenus(page) {
  const rows = page.locator(SELECTORS.dropdownMenuRow)
  const n = await rows.count()
  const out = []
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    const cells = row.locator('td')
    const cellCount = await cells.count()
    const texts = []
    for (let c = 0; c < cellCount; c++) texts.push((await cells.nth(c).innerText().catch(() => '')).trim())
    const menu = {
      menu_name: texts[0] ?? null,
      item_type: texts[1] ?? null,
      item_category: texts[2] ?? null,
      reference: texts[3] ?? null,
      selected_items: [],
      _raw_cells: DEBUG ? texts : undefined,
    }
    // Try to open the "add items" dialog, read selected items, then cancel
    const addBtn = row.locator(SELECTORS.dropdownAddItemsButton).first()
    if (await addBtn.count() > 0) {
      try {
        await addBtn.click()
        await sleep(700)
        const toggle = page.locator(SELECTORS.showOnlySelectedCheckbox).first()
        if (await toggle.count() > 0 && !(await toggle.isChecked().catch(() => false))) {
          await toggle.check().catch(() => {})
          await sleep(500)
        }
        // Items list: assume each row has the item name in first cell
        const itemRows = page.locator('role=dialog table tbody tr')
        const ic = await itemRows.count()
        for (let k = 0; k < ic; k++) {
          const cellsK = itemRows.nth(k).locator('td')
          const cc = await cellsK.count()
          const t = []
          for (let c = 0; c < cc; c++) t.push((await cellsK.nth(c).innerText().catch(() => '')).trim())
          if (t[0]) menu.selected_items.push({ name: t[0], category: t[1] ?? null })
        }
        await clickIfExists(page, SELECTORS.dialogCancel)
        await sleep(300)
      } catch (e) {
        menu._error = e.message
      }
    }
    out.push(menu)
  }
  return out
}

async function extractDefaultItems(page) {
  const rows = page.locator(SELECTORS.defaultItemRow)
  const n = await rows.count()
  const out = []
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    const cells = row.locator('td')
    const cellCount = await cells.count()
    const texts = []
    for (let c = 0; c < cellCount; c++) texts.push((await cells.nth(c).innerText().catch(() => '')).trim())
    const item = {
      idx: i + 1,
      _raw_cells: DEBUG ? texts : undefined,
      name: texts[1] ?? texts[0] ?? null,
      kind: texts[0] ?? null, // LaborRate / MachineRate / Material
      formula: null,
      multiplier: null,
      per_li: null,
      include_in_base_price: null,
      modifier: null,
    }
    const editBtn = row.locator(SELECTORS.defaultItemEditButton).first()
    if (await editBtn.count() > 0) {
      try {
        await editBtn.click()
        await sleep(900)
        const dialog = page.locator(SELECTORS.defaultItemDialog).first()
        // Best-effort pulls — adjust names to match real labels
        item.formula = await readInputValue(dialog, 'select[name="formula"], [aria-label="Formula"]')
        const multRaw = await readInputValue(dialog, 'input[name="multiplier"], [aria-label="Multiplier"]')
        item.multiplier = multRaw == null || multRaw === '' ? null : Number(multRaw)
        item.per_li = await isCheckboxChecked(dialog, 'input[name="per_li_unit"], [aria-label*="per LI" i]')
        item.include_in_base_price = await isCheckboxChecked(dialog, 'input[name="include_in_base_price"], [aria-label*="include in base" i]')
        const customToggle = dialog.locator('input[type="checkbox"][aria-label*="custom" i], label:has-text("Custom") input').first()
        const customOn = await isCheckboxChecked(dialog, customToggle)
        if (customOn) {
          const expr = await readInputValue(dialog, 'textarea[name*="numeric" i], input[name*="numeric" i]')
          if (expr) item.modifier = { kind: 'formula', expression: expr }
        } else {
          const numMod = await readInputValue(dialog, 'select[name*="numeric" i]')
          const boolMod = await readInputValue(dialog, 'select[name*="checkbox" i], select[name*="boolean" i]')
          if (numMod) item.modifier = { kind: 'numeric', expression: numMod }
          else if (boolMod) item.modifier = { kind: 'checkbox', expression: boolMod }
        }
        await clickIfExists(page, SELECTORS.defaultItemCloseButton)
        await sleep(300)
      } catch (e) {
        item._error = e.message
      }
    }
    out.push(item)
  }
  return out
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
  await page.goto(URLS.products, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  const url = page.url()
  if (SELECTORS.loggedOutUrlPattern.test(url)) {
    console.log('\n⚠ Not logged into ShopVOX.')
    console.log('Log in manually in the open browser window, then press ENTER here to continue.')
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    await new Promise((r) => process.stdin.once('data', r))
    process.stdin.pause()
    await page.goto(URLS.products, { waitUntil: 'domcontentloaded' })
    await sleep(1500)
    if (SELECTORS.loggedOutUrlPattern.test(page.url())) {
      throw new Error('Still not logged in after prompt. Aborting.')
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const startAt = Date.now()
  console.log('Fetching pending products from Supabase…')
  const allPending = await fetchPendingProducts()
  console.log(`  Pending: ${allPending.length}`)
  const pending = LIMIT ? allPending.slice(0, LIMIT) : allPending
  if (LIMIT) console.log(`  Limited to: ${pending.length}`)

  const { browser, context, isPersistent } = await launchBrowser()
  const page = context.pages()[0] ?? await context.newPage()
  await ensureLoggedIn(page)

  let success = 0, skipped = 0, failed = 0

  for (let i = 0; i < pending.length; i++) {
    const product = pending[i]
    const label = `${i + 1}/${pending.length}  ${product.name}`

    if (RESUME && progress.done[product.id]) { skipped++; console.log(`  SKIP  ${label}  (already done ${progress.done[product.id]})`); continue }

    process.stdout.write(`  EXTRACTING  ${label}… `)
    const productStart = Date.now()
    try {
      const extracted = await Promise.race([
        extractProduct(page, product),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 30s')), 30000)),
      ])
      await saveToDb(product, extracted)
      const ms = Date.now() - productStart
      console.log(`OK (${ms}ms, mods=${extracted.modifiers.length}, dd=${extracted.dropdown_menus.length}, items=${extracted.default_items.length})`)
      progress.done[product.id] = new Date().toISOString()
      saveJson(PROGRESS_FILE, progress)
      success++
    } catch (e) {
      const msg = e?.message ?? String(e)
      console.log(`FAIL  ${msg}`)
      await screenshot(page, `ERR_${product.id}`)
      errors.errors.push({ id: product.id, name: product.name, error: msg, at: new Date().toISOString() })
      saveJson(ERRORS_FILE, errors)
      failed++
    }

    // Throttle
    await sleep(1000)
    if ((i + 1) % 50 === 0) await sleep(3000)
  }

  if (isPersistent) await context.close()
  else if (browser) await browser.close()

  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1)
  const avg = success > 0 ? ((Date.now() - startAt) / 1000 / success).toFixed(1) : '—'
  const remaining = allPending.length - Object.keys(progress.done).length
  const etaMin = success > 0 ? ((remaining * Number(avg)) / 60).toFixed(1) : '—'
  console.log('\n──────────────── Summary ────────────────')
  console.log(`  Total in queue:           ${pending.length}`)
  console.log(`  Successfully extracted:   ${success}`)
  console.log(`  Skipped (already done):   ${skipped}`)
  console.log(`  Failed / missed:          ${failed}`)
  console.log(`  Elapsed:                  ${elapsed}s`)
  console.log(`  Avg per product:          ${avg}s`)
  console.log(`  Remaining (org-wide):     ${remaining}`)
  console.log(`  ETA for full run:         ${etaMin} min`)
  if (failed > 0) console.log(`  → Errors logged to:       ${ERRORS_FILE}`)
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })

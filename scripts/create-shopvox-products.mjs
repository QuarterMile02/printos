// Creates new PrintOS products from ShopVOX for products confirmed to have
// no PrintOS name match (see scripts/reconcile-shopvox-products.mjs).
//
// Re-verifies each product live on ShopVOX immediately before creating (a
// product could have been renamed/deleted since the reconciliation pass),
// reads Basic Settings + Advanced Settings for the base record, then reuses
// shopvox-extract.mjs's exact proven per-product recipe extraction
// (extractProduct: pricing type, basicPricing, Modifiers/Dropdown Menus/
// Default Items or Grid pricing) on the same product page -- copied
// verbatim from that file, not re-derived -- so this doesn't duplicate a
// second, possibly-drifting copy of already-proven DOM logic.
//
// After creating the base row + shopvox_data, expands it into the real
// relational tables (product_default_items, product_modifiers,
// product_dropdown_menus, product_option_rates) using the exact same
// name-matching logic as src/app/api/products/bulk-import-shopvox/route.ts
// -- scoped to only the products this run creates, not every eligible
// product org-wide (unlike hitting that live API route, which processes
// everything with shopvox_data set regardless of scope).
//
// Usage:
//   node scripts/create-shopvox-products.mjs --create-ids=uuid1,uuid2,...
//   node scripts/create-shopvox-products.mjs --create-ids=uuid1 --inactive=uuid1
//                                              # comma list of ids to force active=false,
//                                              # status='disabled' after creation
//   node scripts/create-shopvox-products.mjs --create-ids=uuid1 --exact-name
//                                              # skip nothing -- name is ALWAYS taken
//                                              # verbatim from ShopVOX either way; this
//                                              # flag only silences the "does this name
//                                              # look like a draft?" heuristic warning

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const argv = process.argv.slice(2)
function getFlag(name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  return eq ? eq.slice(name.length + 1) : null
}
const CREATE_IDS = (getFlag('--create-ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const INACTIVE_IDS = new Set((getFlag('--inactive') ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const CDP_URL = getFlag('--cdp')
if (CREATE_IDS.length === 0) { console.error('Usage: --create-ids=uuid1,uuid2,...'); process.exit(1) }

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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const CREATOR_ID = 'f86f2712-ebcd-4faa-bccb-0f0580bcfeae' // same constant used by every one-off DB script tonight

const SESSION_DIR = resolve(__dirname, '.shopvox-session')
const DEBUG_DIR = resolve(__dirname, 'shopvox-debug')
const OUTPUT_FILE = resolve(__dirname, 'shopvox-products-create-output.json')

const URLS = {
  base: 'https://express.shopvox.com',
  product: (id) => `https://express.shopvox.com/settings/products/${id}`,
  basicSettings: (id) => `https://express.shopvox.com/settings/products/${id}/basic-settings`,
  advancedSettings: (id) => `https://express.shopvox.com/settings/products/${id}/advanced-settings`,
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function screenshot(page, label) {
  if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true })
  const safe = label.replace(/[^\w-]+/g, '_').slice(0, 80)
  try { await page.screenshot({ path: resolve(DEBUG_DIR, `${Date.now()}_${safe}.png`), fullPage: true }) } catch {}
}

// A single unbounded .select() with no .range() is silently capped at
// PostgREST's default page size (1000 rows) -- the exact bug class found
// live tonight in materials (1,788 rows, silently truncated to 1000,
// causing 14 real materials to read as "unmatched" even though every one
// of them already existed under the exact same name). Every bulk-read
// query in this script is paginated uniformly with this helper -- not
// just materials -- so nothing else here quietly hits the same wall as
// the catalog grows, same reasoning already applied in
// bulk-import-shopvox/route.ts and scrape-shopvox-material-tiers.js.
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

// ── Reference caches ─────────────────────────────────────────────────
const REF = { types: null, categories: null, workflows: null, modifiers: null }
async function loadRefCaches() {
  if (REF.types) return REF
  const lc = (s) => (s ?? '').toLowerCase().trim()
  const [types, cats, wfs, mods] = await Promise.all([
    fetchAllRows((from, to) => sb.from('product_types').select('id, name').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)),
    fetchAllRows((from, to) => sb.from('product_categories').select('id, name').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)),
    fetchAllRows((from, to) => sb.from('workflow_templates').select('id, name').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)),
    fetchAllRows((from, to) => sb.from('modifiers').select('id, name, display_name, system_lookup_name').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)),
  ])
  REF.types = new Map(types.map((t) => [lc(t.name), t.id]))
  REF.categories = new Map(cats.map((c) => [lc(c.name), c.id]))
  REF.workflows = new Map(wfs.map((w) => [lc(w.name), w.id]))
  REF.modifiers = new Map()
  for (const m of mods) {
    for (const k of [m.system_lookup_name, m.display_name, m.name].filter(Boolean).map(lc)) {
      if (!REF.modifiers.has(k)) REF.modifiers.set(k, m.id)
    }
  }
  return REF
}

// ── Browser setup — identical pattern to every other ShopVOX script tonight ─
async function launchBrowser() {
  if (CDP_URL) {
    const browser = await chromium.connectOverCDP(CDP_URL)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    return { context }
  }
  for (const lock of ['SingletonLock', 'lockfile', 'Default/LOCK']) {
    const lockPath = resolve(SESSION_DIR, lock)
    if (existsSync(lockPath)) { try { unlinkSync(lockPath) } catch {} }
  }
  console.log(`Launching persistent Chromium (session: ${SESSION_DIR})`)
  const context = await chromium.launchPersistentContext(SESSION_DIR, { headless: false, channel: 'chromium', viewport: { width: 1440, height: 900 } })
  return { context }
}

async function ensureLoggedIn(page) {
  await page.goto(URLS.base + '/settings/products', { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {})
  if (!/\/sign-in/i.test(page.url())) return
  console.log('\n  MANUAL STEP — log into ShopVOX in the open Chromium window, then press ENTER here.\n')
  process.stdin.resume(); process.stdin.setEncoding('utf8')
  await new Promise((res) => process.stdin.once('data', () => res()))
  process.stdin.pause()
  await page.goto(URLS.base + '/settings/products', { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {})
  if (/\/sign-in/i.test(page.url())) { console.error('✗ Still on sign-in — login did not take.'); process.exit(1) }
}

// ── Basic Settings + Advanced Settings readers ──────────────────────
// Same floating-label-wrapper pattern already confirmed live for
// Configure Pricing's basicPricing read in shopvox-extract.mjs -- inlined
// directly in each page.evaluate callback (no cross-boundary function
// passing) matching how every other DOM read in this codebase is written.
async function readBasicSettings(page, shopvoxId) {
  await page.goto(URLS.basicSettings(shopvoxId), { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('text="Product Name"', { timeout: 20000 }).catch(() => null)
  await sleep(1000)
  return page.evaluate(() => {
    const read = (labelText, kind) => {
      const wrappers = Array.from(document.querySelectorAll('[class*="_floatingWrapper"], .field-wrapper-container'))
      const wrapper = wrappers.find((w) => {
        const label = w.querySelector('label, [class*="_floatingLabel"]')
        return label?.innerText?.trim().replace('*', '').trim() === labelText
      })
      if (!wrapper) return null
      if (kind === 'checkbox') { const cb = wrapper.querySelector('input[type="checkbox"]'); return cb ? !!cb.checked : null }
      if (kind === 'dropdown') {
        const selected = wrapper.querySelector('[class*="singleValue"]')
        if (selected) return selected.innerText?.trim() || null
        return wrapper.querySelector('input, select')?.value?.trim() || null
      }
      const input = wrapper.querySelector('input, textarea')
      return input?.value?.trim() || null
    }
    return {
      name: read('Product Name'),
      description: read('Product Description'),
      interface: read('Interface', 'dropdown'),
      type: read('Type', 'dropdown'),
      workflow_template: read('Workflow Template', 'dropdown'),
      category: read('Category', 'dropdown'),
      secondary_category: read('Secondary Category', 'dropdown'),
    }
  })
}

async function readAdvancedSettings(page, shopvoxId) {
  await page.goto(URLS.advancedSettings(shopvoxId), { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('text="Account Settings"', { timeout: 20000 }).catch(() => null)
  await sleep(1000)
  return page.evaluate(() => {
    const read = (labelText, kind) => {
      const wrappers = Array.from(document.querySelectorAll('[class*="_floatingWrapper"], .field-wrapper-container'))
      const wrapper = wrappers.find((w) => {
        const label = w.querySelector('label, [class*="_floatingLabel"]')
        return label?.innerText?.trim().replace('*', '').trim() === labelText
      })
      if (!wrapper) return null
      if (kind === 'checkbox') { const cb = wrapper.querySelector('input[type="checkbox"]'); return cb ? !!cb.checked : null }
      if (kind === 'dropdown') {
        const selected = wrapper.querySelector('[class*="singleValue"]')
        if (selected) return selected.innerText?.trim() || null
        return wrapper.querySelector('input, select')?.value?.trim() || null
      }
      const input = wrapper.querySelector('input, textarea')
      return input?.value?.trim() || null
    }
    return {
      income_account: read('Income Account', 'dropdown'),
      cog_account: read('COG Account', 'dropdown'),
      default_sale_type: read('Default Sale Type', 'dropdown'),
      qb_item_type: read('QuickBooks Item Type', 'dropdown'),
      rounding: read('Round Unit Price to', 'dropdown'),
      taxable: read('Taxable', 'checkbox'),
      pay_commissions: read('Pay Commissions', 'checkbox'),
      include_base_product_in_po: read('Include Base Product in PO', 'checkbox'),
    }
  })
}

// ══════════════════════════════════════════════════════════════════════
// EVERYTHING BELOW THIS LINE IS COPIED VERBATIM FROM scripts/shopvox-extract.mjs
// (extractModalFields, closeOpenModal, scrapeDropdownSelectedItems,
// scrapeGridRowsStructural, scrapeGridPricing, extractProduct) -- the
// already-proven per-product recipe extraction. Not re-derived. Any
// selector/behavior fix made there should be ported here too.
// ══════════════════════════════════════════════════════════════════════

async function extractModalFields(page) {
  return await page.evaluate(() => {
    const modal =
      document.querySelector('._ModalContent_1tz2y_44') ||
      Array.from(document.querySelectorAll('div')).find((d) => {
        const h = d.querySelector('h2, h3, h4')
        return h && (h.innerText || '').includes('Edit')
      })
    if (!modal) return null
    const norm = (s) => (s || '').trim().replace(/^\*\s*/, '')
    const getField = (labelText) => {
      const allEls = Array.from(modal.querySelectorAll('*'))
      const label = allEls.find((el) => norm(el.innerText) === labelText && el.children.length <= 2)
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
      const label = allEls.find((el) => norm(el.innerText) === labelText && el.tagName !== 'OPTION')
      if (!label) return null
      const container = label.closest('div[class*="select"], div[class*="dropdown"]') || label.parentElement?.parentElement
      if (!container) return null
      const displayed = container.querySelector('[class*="singleValue"]') || container.querySelector('[class*="value"], [class*="selected"]')
      if (displayed) return (displayed.innerText || '').trim() || null
      const select = container.querySelector('select')
      if (select) return select.options[select.selectedIndex]?.text
      return null
    }
    let heading = ''
    for (const sel of ['._ModalContent_1tz2y_44 h1', '._ModalContent_1tz2y_44 h2', '._ModalContent_1tz2y_44 h3', '._ModalContent_1tz2y_44 [class*="heading"]', '._ModalContent_1tz2y_44 [class*="title"]']) {
      const el = document.querySelector(sel)
      if (el) { const t = (el.innerText || '').trim(); if (t) { heading = t; break } }
    }
    if (!heading) {
      const content = document.querySelector('._ModalContent_1tz2y_44')
      if (content) {
        const el = Array.from(content.querySelectorAll('div')).find((e) => (e.innerText || '').trim().startsWith('Edit') && e.children.length <= 3)
        if (el) heading = (el.innerText || '').trim().split('\n')[0].trim()
      }
    }
    if (!heading) heading = (modal.querySelector('h1, h2, h3, h4')?.innerText || '').trim()

    if (heading.includes('Default Item')) {
      const _formula = getDropdownValue('Formula') || getDropdownValue('System Formula')
      const _numMod = getDropdownValue('Attach to a Numeric Modifier')
      const _chkMod = getDropdownValue('Attach to a Checkbox Modifier')
      const _itemType = getDropdownValue('Item Type') || getField('Item Type')
      return {
        type: 'default_item', heading, item_type: _itemType,
        item_sub_type: getDropdownValue('Item Sub Type'), category: getDropdownValue('Category'),
        material: getDropdownValue('Material'), formula: _formula, multiplier: getField('Multiplier'),
        per_li_unit: getCheckbox('Per LI Unit'), include_in_base_price: getCheckbox('Include in Base Price'),
        numeric_modifier: _numMod, checkbox_modifier: _chkMod,
      }
    }
    if (heading.includes('Dropdown Menu')) {
      return {
        type: 'dropdown_menu', heading, menu_name: getField('Menu Name'), item: getDropdownValue('Item'),
        item_type: getDropdownValue('Item Type'), item_category: getDropdownValue('Item Category'),
        item_kind: getDropdownValue('Item Kind'), formula: getDropdownValue('System Formula'),
        charge_per_li_unit: getCheckbox('Charge Per LI Unit'), include_in_base_price: getCheckbox('Include in Base Price'),
        optional: getCheckbox('This Dropdown Menu is Optional'), use_item_per_li_unit: getCheckbox('Use Item Per LI Unit'),
        percentage_of_base: getField('Percentage of Base'), multiplier: getField('Multiplier'),
        fixed_quantity: getField('Fixed Quantity'), reference: getField('Reference'),
        numeric_modifier: getDropdownValue('Attach to a Numeric Modifier'), checkbox_modifier: getDropdownValue('Attach to a Checkbox Modifier'),
      }
    }
    if (heading.includes('Modifier')) {
      return { type: 'modifier', heading, attribute: getDropdownValue('Attribute'), default_value: getField('DefaultValue') || getField('Default Value'), optional: getCheckbox('This Attribute is Optional') }
    }
    return { type: 'unknown', heading }
  })
}

async function closeOpenModal(page) {
  if (!(await page.$('._ModalOverlay_1tz2y_28'))) return
  const overlayGone = async () => !(await page.$('._ModalOverlay_1tz2y_28'))
  try {
    const xBtn = page.locator('._button_pckdd_26 button, ._button_pckdd_26').first()
    if ((await xBtn.count()) > 0) { await xBtn.click({ timeout: 1000, force: true }); await sleep(300); if (await overlayGone()) { await sleep(300); return } }
  } catch {}
  await page.keyboard.press('Escape'); await sleep(300); if (await overlayGone()) { await sleep(300); return }
  try {
    const cancelBtn = page.locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label="Close"]').first()
    if ((await cancelBtn.count()) > 0) { await cancelBtn.click({ timeout: 1000, force: true }); await sleep(300); if (await overlayGone()) { await sleep(300); return } }
  } catch {}
  try {
    await page.locator('._ModalOverlay_1tz2y_28').click({ timeout: 1000, force: true, position: { x: 10, y: 10 } })
    await sleep(300); if (await overlayGone()) { await sleep(300); return }
  } catch {}
  await page.evaluate(() => { document.querySelector('._ModalOverlay_1tz2y_28')?.remove() })
  await sleep(500)
}

async function scrapeDropdownSelectedItems(page, rowLoc, rowIndex) {
  try {
    await closeOpenModal(page)
    const buttons = rowLoc.locator('button')
    if ((await buttons.count()) < 1) return []
    try { await buttons.nth(0).scrollIntoViewIfNeeded(); await buttons.nth(0).click({ timeout: 3000, force: true }) } catch { return [] }
    let showSelectedEl = null
    for (let t = 0; t < 20; t++) {
      await sleep(300)
      const cand = page.locator('button, label, input[type="checkbox"]').filter({ hasText: 'Show Only Selected' })
      if ((await cand.count()) > 0) { showSelectedEl = cand.first(); break }
    }
    if (!showSelectedEl) { await page.keyboard.press('Escape'); await sleep(300); return [] }
    let prevLoadText = null
    for (let loadIter = 0; loadIter < 10; loadIter++) {
      const loadRemainingBtn = page.locator('button').filter({ hasText: /load.*remaining/i }).first()
      if ((await loadRemainingBtn.count()) === 0) break
      const loadText = (await loadRemainingBtn.innerText().catch(() => '')).trim()
      if (loadText === prevLoadText) break
      prevLoadText = loadText
      await loadRemainingBtn.click({ timeout: 5000, force: true }).catch(() => {})
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) { await sleep(500); if ((await page.locator('button').filter({ hasText: /load.*remaining/i }).count()) === 0) break }
      await sleep(500)
    }
    const labelText = await showSelectedEl.innerText().catch(() => '')
    const countMatch = labelText.match(/\((\d+)\)/)
    const selectedCount = countMatch ? parseInt(countMatch[1], 10) : 0
    if (selectedCount === 0) { await page.keyboard.press('Escape'); await sleep(300); return [] }
    await page.keyboard.press('Escape'); await sleep(500)
    try { await buttons.nth(0).click({ timeout: 3000, force: true }) } catch { return [] }
    await sleep(1000)
    const freshShowSelected = page.locator('button, label, input[type="checkbox"]').filter({ hasText: 'Show Only Selected' }).first()
    await freshShowSelected.click({ timeout: 3000, force: true }).catch(() => {})
    await sleep(1000)
    let items = []
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(800)
      const allCells = await page.locator('[class*="_contentCell_"][header="Name"]').allInnerTexts()
      items = allCells.map((t) => t.trim()).filter((t) => t.length > 0).slice(-selectedCount)
      if (items.length >= selectedCount) break
    }
    await page.keyboard.press('Escape'); await sleep(300)
    try {
      const closeBtn = page.locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label="Close"]').first()
      if ((await closeBtn.count()) > 0) await closeBtn.click({ timeout: 2000, force: true }).catch(() => {})
    } catch {}
    await sleep(300)
    return items
  } catch { try { await page.keyboard.press('Escape') } catch {}; return [] }
}

async function scrapeGridRowsStructural(page) {
  return page.evaluate(() => {
    const rowRe = /^rows\[(\d+)\]\.xValue$/
    const itemRe = /^rows\[(\d+)\]\.items\[(\d+)\]\.priceInDollars$/
    const rowsByIndex = new Map()
    for (const input of document.querySelectorAll('input[name^="rows["]')) {
      const rowMatch = input.name.match(rowRe)
      if (rowMatch) { const idx = Number(rowMatch[1]); const row = rowsByIndex.get(idx) ?? { xValue: null, items: [] }; row.xValue = input.value.trim(); rowsByIndex.set(idx, row); continue }
      const itemMatch = input.name.match(itemRe)
      if (itemMatch) { const idx = Number(itemMatch[1]); const itemIdx = Number(itemMatch[2]); const row = rowsByIndex.get(idx) ?? { xValue: null, items: [] }; row.items[itemIdx] = input.value.trim(); rowsByIndex.set(idx, row) }
    }
    return Array.from(rowsByIndex.entries()).sort((a, b) => a[0] - b[0]).map(([, row]) => [row.xValue, ...row.items])
  })
}

async function scrapeGridPricing(page) {
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'))
    const costLabel = labels.find((l) => l.innerText?.trim().includes("Show 'Cost'") || l.innerText?.trim().includes('Show "Cost"'))
    if (costLabel) { const cb = costLabel.querySelector('input[type="checkbox"]'); if (cb && !cb.checked) costLabel.click() }
  })
  await page.waitForTimeout(1000)
  const finishTabNames = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'))
    const finishHeader = all.find((el) => el.tagName === 'SPAN' && el.innerText?.trim() === 'Finish' && el.parentElement?.className?.includes('f-direction-c'))
    if (!finishHeader) return []
    const finishGrandParent = finishHeader.parentElement?.parentElement
    if (!finishGrandParent) return []
    const tabs = Array.from(finishGrandParent.querySelectorAll('[class*="_wrapper_p6s6a_1"]')).map((el) => el.innerText.trim()).filter((t) => t.length > 0 && t.length < 30)
    return tabs.slice(1)
  })
  if (!finishTabNames.length) {
    const attrRows = await scrapeGridRowsStructural(page)
    return { grid_pricing: { type: 'attribute', rows: attrRows } }
  }
  const finishes = {}
  for (const finishName of finishTabNames) {
    await page.evaluate((tabName) => {
      const all = Array.from(document.querySelectorAll('*'))
      const finishHeader = all.find((el) => el.tagName === 'SPAN' && el.innerText?.trim() === 'Finish' && el.parentElement?.className?.includes('f-direction-c'))
      const finishGrandParent = finishHeader?.parentElement?.parentElement
      const tab = finishGrandParent ? Array.from(finishGrandParent.querySelectorAll('[class*="_wrapper_p6s6a_1"]')).find((el) => el.innerText.trim() === tabName) : null
      if (tab) tab.click()
    }, finishName)
    await page.waitForTimeout(1500)
    finishes[finishName] = await scrapeGridRowsStructural(page)
  }
  return { grid_pricing: { finishes } }
}

async function extractProduct(page, shopvoxUrl) {
  const ROWS_SEL = 'div[aria-roledescription="sortable"]'
  await page.goto(shopvoxUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  let loaded = false
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    const title = await page.title()
    const hasConfig = await page.locator('#product-detail-config').count()
    if (title !== 'shopVOX' && hasConfig > 0) { loaded = true; break }
  }
  if (!loaded) console.log('  WARNING: Product may not have fully loaded')
  await closeOpenModal(page)
  const cpTab = page.locator('text="Configure Pricing"').first()
  if (await cpTab.count() > 0) {
    await cpTab.click().catch(() => {})
    await page.waitForSelector('text="Pricing Settings"', { timeout: 10000 }).catch(() => null)
    await sleep(1000)
  }
  await closeOpenModal(page)
  const pricingType = await page.evaluate(() => document.querySelector('[class*="singleValue"]')?.innerText?.trim() || 'Unknown')
  const basicPricing = await page.evaluate(() => {
    const getInputVal = (labelText) => {
      const wrappers = Array.from(document.querySelectorAll('[class*="_floatingWrapper"], .field-wrapper-container'))
      const wrapper = wrappers.find((w) => w.querySelector('label, [class*="_floatingLabel"]')?.innerText?.trim().replace('*', '').trim() === labelText)
      return wrapper?.querySelector('input')?.value?.trim() || null
    }
    const getDropdownVal = (labelText) => {
      const wrappers = Array.from(document.querySelectorAll('[class*="_floatingWrapper"], .field-wrapper-container'))
      const wrapper = wrappers.find((w) => w.querySelector('label, [class*="_floatingLabel"]')?.innerText?.trim().replace('*', '').trim() === labelText)
      if (!wrapper) return null
      const selected = wrapper.querySelector('[class*="singleValue"]')
      if (selected) return selected.innerText?.trim() || null
      return wrapper.querySelector('input, select')?.value?.trim() || null
    }
    return {
      buying_cost: getInputVal('Buying Cost ($)'), cost: getInputVal('Cost ($)'), markup: getInputVal('Markup (X)'),
      price: getInputVal('Price ($)'), units: getDropdownVal('Units'), buying_units: getDropdownVal('Buying Units'),
      conversion_factor: getInputVal('Conversion Factor'),
    }
  })

  const parseCells = (t) => t.split(/[\t\n|]+/).map((s) => s.trim()).filter(Boolean)
  const expandSection = async (sectionName) => {
    await closeOpenModal(page)
    const header = page.locator(`text="${sectionName}"`).first()
    try { await header.waitFor({ state: 'visible', timeout: 5000 }) } catch { return null }
    try { await header.scrollIntoViewIfNeeded(); await header.click({ timeout: 5000 }) } catch { return null }
    await sleep(1000)
    return page.locator(ROWS_SEL).count()
  }
  const openAndExtractModal = async (rowLoc, buttonIndex, rowIndex) => {
    await closeOpenModal(page)
    const buttons = rowLoc.locator('button')
    if ((await buttons.count()) <= buttonIndex) return null
    try { await buttons.nth(buttonIndex).scrollIntoViewIfNeeded(); await buttons.nth(buttonIndex).click({ timeout: 3000, force: true }) } catch { await closeOpenModal(page); return null }
    let heading = null
    for (let t = 0; t < 50; t++) {
      await sleep(300)
      heading = await page.evaluate(() => {
        for (const sel of ['._ModalContent_1tz2y_44 h1', '._ModalContent_1tz2y_44 h2', '._ModalContent_1tz2y_44 h3', '._ModalContent_1tz2y_44 [class*="heading"]', '._ModalContent_1tz2y_44 [class*="title"]']) {
          const el = document.querySelector(sel); if (el) { const t = (el.innerText || '').trim(); if (t) return t }
        }
        const content = document.querySelector('._ModalContent_1tz2y_44')
        if (content) { const el = Array.from(content.querySelectorAll('*')).find((e) => (e.innerText || '').trim().startsWith('Edit') && e.children.length <= 3); if (el) return (el.innerText || '').trim().split('\n')[0].trim() }
        return null
      })
      if (heading) break
    }
    if (!heading) { await closeOpenModal(page); return null }
    let fields = null
    try { fields = await extractModalFields(page) } catch {}
    await closeOpenModal(page)
    return fields
  }

  let modifiers = [], dropdown_menus = [], default_items = []
  const pricing = { pricing_type: pricingType, ...basicPricing }
  if (pricingType === 'Grid') {
    const gridResult = await scrapeGridPricing(page)
    pricing.grid_pricing = gridResult.grid_pricing
  } else {
    let offset = 0
    const afterMod = await expandSection('Modifiers')
    if (afterMod != null) {
      for (let i = offset; i < afterMod; i++) {
        const row = page.locator(ROWS_SEL).nth(i)
        const c = parseCells((await row.innerText()).trim())
        const base = { name: c[0] ?? null, type: c[1] ?? null, default: c[2] ?? null }
        base.modal = await openAndExtractModal(row, 0, i)
        modifiers.push(base)
      }
      offset = afterMod
    }
    const afterDD = await expandSection('Dropdown Menus')
    if (afterDD != null) {
      for (let i = offset; i < afterDD; i++) {
        const row = page.locator(ROWS_SEL).nth(i)
        const c = parseCells((await row.innerText()).trim())
        const modal = await openAndExtractModal(row, 1, i)
        const selected_items = await scrapeDropdownSelectedItems(page, row, i)
        dropdown_menus.push({
          menu_name: c[0] ?? null, item_type: c[1] ?? null, category: c[2] ?? null,
          reference: modal?.reference ?? null, formula: modal?.formula ?? null, multiplier: modal?.multiplier ?? null,
          fixed_quantity: modal?.fixed_quantity ?? null, percentage_of_base: modal?.percentage_of_base ?? null,
          charge_per_li_unit: modal?.charge_per_li_unit ?? null, include_in_base_price: modal?.include_in_base_price ?? null,
          optional: modal?.optional ?? null, use_item_per_li_unit: modal?.use_item_per_li_unit ?? null,
          attach_num_modifier: modal?.numeric_modifier ?? null, attach_chk_modifier: modal?.checkbox_modifier ?? null,
          selected_items,
        })
      }
      offset = afterDD
    }
    const afterDI = await expandSection('Default Items')
    if (afterDI != null) {
      for (let i = offset; i < afterDI; i++) {
        const row = page.locator(ROWS_SEL).nth(i)
        const c = parseCells((await row.innerText()).trim())
        const base = { name: c[0] ?? null, item_type: c[1] ?? null }
        base.modal = await openAndExtractModal(row, 0, i)
        default_items.push(base)
      }
    }
  }
  return { pricing, modifiers, dropdown_menus, default_items }
}

// ══════════════════════════════════════════════════════════════════════
// NEW: create + relational-population logic
// ══════════════════════════════════════════════════════════════════════

function n(v) { if (v == null || v === '') return null; const x = Number(String(v).replace(/[$,]/g, '')); return Number.isFinite(x) ? x : null }

async function createProductRecord(basic, advanced, pricing, forceInactive) {
  const refs = await loadRefCaches()
  const lc = (s) => (s ?? '').toLowerCase().trim()

  const { data: existing } = await sb.from('products').select('id').eq('organization_id', ORG_ID).eq('name', basic.name).limit(1).maybeSingle()
  if (existing) return { status: 'flagged', reason: `PrintOS already has a product named exactly "${basic.name}" (id ${existing.id}) — not creating a duplicate`, productId: existing.id }

  const typeId = basic.type ? refs.types.get(lc(basic.type)) : null
  const categoryId = basic.category ? refs.categories.get(lc(basic.category)) : null
  const workflowId = basic.workflow_template ? refs.workflows.get(lc(basic.workflow_template)) : null
  const unresolvedRefs = []
  if (basic.type && !typeId) unresolvedRefs.push('product_type_id')
  if (basic.category && !categoryId) unresolvedRefs.push('product_category_id')
  if (basic.workflow_template && !workflowId) unresolvedRefs.push('workflow_template_id')

  const insertPayload = {
    organization_id: ORG_ID,
    name: basic.name, // verbatim — never cleaned up, per instruction
    description: basic.description || null,
    product_type: basic.type || null,
    product_type_id: typeId ?? null,
    category_id: categoryId ?? null,
    product_category_id: categoryId ?? null,
    secondary_category: basic.secondary_category || null,
    workflow_template_id: workflowId ?? null,
    status: forceInactive ? 'disabled' : 'published',
    active: !forceInactive,
    income_account: advanced.income_account || null,
    cog_account: advanced.cog_account || null,
    default_sale_type: advanced.default_sale_type || null,
    qb_item_type: advanced.qb_item_type || null,
    rounding: n(advanced.rounding) ?? 2,
    taxable: advanced.taxable ?? true,
    in_house_commission: advanced.pay_commissions ?? false,
    include_base_product_in_po: advanced.include_base_product_in_po ?? false,
    pricing_type: ['Formula', 'Basic', 'Grid', 'Cost Plus'].includes(pricing.pricing_type) ? pricing.pricing_type : 'Formula',
    buying_cost: n(pricing.buying_cost) ?? 0,
    cost: n(pricing.cost) ?? 0,
    markup: n(pricing.markup) ?? 2.0,
    price: n(pricing.price) ?? 0,
    units: pricing.units || 'Each',
    buying_units: pricing.buying_units || 'Each',
    conversion_factor: n(pricing.conversion_factor) ?? 1,
    created_by: CREATOR_ID,
    updated_by: CREATOR_ID,
  }

  const { data: created, error } = await sb.from('products').insert(insertPayload).select('id').maybeSingle()
  if (error) return { status: 'flagged', reason: `insert failed: ${error.message}` }
  return { status: 'created', productId: created.id, unresolvedRefs }
}

async function writeShopvoxData(productId, basic, extracted) {
  const shopvox_data = {
    basic: {
      name: basic.name, type: basic.type, workflow: basic.workflow_template,
      category: basic.category, secondary_category: basic.secondary_category,
    },
    pricing: extracted.pricing,
    modifiers: extracted.modifiers,
    dropdown_menus: extracted.dropdown_menus,
    default_items: extracted.default_items,
    extracted_at: new Date().toISOString(),
    extraction_version: 2,
  }
  const { error } = await sb.from('products').update({ shopvox_data }).eq('id', productId)
  if (error) throw new Error(`shopvox_data write failed: ${error.message}`)
  return shopvox_data
}

// Same matching/expansion logic as src/app/api/products/bulk-import-shopvox/route.ts,
// scoped to one just-created product.
async function populateRelationalTables(productId, shopvox_data) {
  const refs = await loadRefCaches()
  const lc = (s) => (s ?? '').toLowerCase().trim()
  const [matsData, laborData, machineData] = await Promise.all([
    fetchAllRows((from, to) => sb.from('materials').select('id, name, category_id, multiplier').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)),
    fetchAllRows((from, to) => sb.from('labor_rates').select('id, name, category').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)),
    fetchAllRows((from, to) => sb.from('machine_rates').select('id, name, category').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)),
  ])
  const materialByName = new Map(matsData.map((m) => [lc(m.name), m]))
  const laborByName = new Map(laborData.map((l) => [lc(l.name), l]))
  const machineByName = new Map(machineData.map((m) => [lc(m.name), m]))

  const modifierRows = []
  const seenMods = new Set()
  for (const m of shopvox_data.modifiers ?? []) {
    const match = refs.modifiers.get(lc(m.name))
    if (!match || seenMods.has(match)) continue
    seenMods.add(match)
    modifierRows.push({ organization_id: ORG_ID, product_id: productId, modifier_id: match, is_required: false, default_value: m.default != null ? String(m.default) : null, sort_order: modifierRows.length })
  }

  const defaultItemRows = []
  const optionRateRows = []
  const seenLabor = new Set(), seenMachine = new Set()
  for (const it of shopvox_data.default_items ?? []) {
    const key = lc(it.name)
    const kind = it.modal?.item_type ?? it.item_type
    const formula = it.modal?.formula ?? null
    const multiplier = n(it.modal?.multiplier) ?? 1
    const perLi = !!it.modal?.per_li_unit
    if (kind === 'Material' || (kind ?? '').toLowerCase().includes('material')) {
      const match = materialByName.get(key)
      defaultItemRows.push({ organization_id: ORG_ID, product_id: productId, item_type: 'Material', material_id: match?.id ?? null, labor_rate_id: null, machine_rate_id: null, custom_item_name: it.name ?? null, menu_name: null, system_formula: formula, charge_per_li_unit: perLi, include_in_base_price: true, is_optional: false, multiplier, workflow_step: false, overrides_material_category_id: match?.category_id ?? null, item_markup: match?.multiplier ?? 1, sort_order: defaultItemRows.length })
    } else if (kind === 'LaborRate' || (kind ?? '').toLowerCase().includes('labor')) {
      const match = laborByName.get(key)
      defaultItemRows.push({ organization_id: ORG_ID, product_id: productId, item_type: 'LaborRate', material_id: null, labor_rate_id: match?.id ?? null, machine_rate_id: null, custom_item_name: it.name ?? null, menu_name: null, system_formula: formula, charge_per_li_unit: perLi, include_in_base_price: false, is_optional: false, multiplier, workflow_step: true, sort_order: defaultItemRows.length })
      if (match && !seenLabor.has(match.id)) { seenLabor.add(match.id); optionRateRows.push({ product_id: productId, rate_type: 'labor_rate', rate_id: match.id, category: match.category, formula: formula ?? 'Area', multiplier, charge_per_li_unit: perLi, include_in_base_price: false, workflow_step: true, sort_order: optionRateRows.length }) }
    } else if (kind === 'MachineRate' || (kind ?? '').toLowerCase().includes('machine')) {
      const match = machineByName.get(key)
      defaultItemRows.push({ organization_id: ORG_ID, product_id: productId, item_type: 'MachineRate', material_id: null, labor_rate_id: null, machine_rate_id: match?.id ?? null, custom_item_name: it.name ?? null, menu_name: null, system_formula: formula, charge_per_li_unit: perLi, include_in_base_price: false, is_optional: false, multiplier, workflow_step: true, sort_order: defaultItemRows.length })
      if (match && !seenMachine.has(match.id)) { seenMachine.add(match.id); optionRateRows.push({ product_id: productId, rate_type: 'machine_rate', rate_id: match.id, category: match.category, formula: formula ?? 'Area', multiplier, charge_per_li_unit: perLi, include_in_base_price: false, workflow_step: true, sort_order: optionRateRows.length }) }
    }
  }

  const dropdownMenus = []
  for (const m of shopvox_data.dropdown_menus ?? []) {
    if (!m.menu_name || !m.menu_name.trim()) continue
    dropdownMenus.push({ menu_name: m.menu_name.trim(), is_optional: !!m.optional || /\(optional\)/i.test(m.menu_name), selected_items: m.selected_items ?? [] })
  }

  if (modifierRows.length > 0) { const r = await sb.from('product_modifiers').insert(modifierRows); if (r.error) throw new Error(`product_modifiers: ${r.error.message}`) }
  if (defaultItemRows.length > 0) { const r = await sb.from('product_default_items').insert(defaultItemRows); if (r.error) throw new Error(`product_default_items: ${r.error.message}`) }
  if (optionRateRows.length > 0) { const r = await sb.from('product_option_rates').insert(optionRateRows); if (r.error) throw new Error(`product_option_rates: ${r.error.message}`) }
  for (let i = 0; i < dropdownMenus.length; i++) {
    const menu = dropdownMenus[i]
    const { data: insertedMenu, error: menuErr } = await sb.from('product_dropdown_menus').insert({ organization_id: ORG_ID, product_id: productId, menu_name: menu.menu_name, is_optional: menu.is_optional, sort_order: i }).select('id').single()
    if (menuErr) throw new Error(`product_dropdown_menus: ${menuErr.message}`)
    // selected_items are ShopVOX item NAMES, not typed (Material/LaborRate/MachineRate) --
    // best-effort match against all three catalogs since the dropdown modal's own item_type
    // field describes the dropdown's constraint, not necessarily each individual item's kind.
    const itemRows = []
    for (const itemName of menu.selected_items) {
      const key = lc(itemName)
      const matM = materialByName.get(key), matL = laborByName.get(key), matMc = machineByName.get(key)
      if (matM) itemRows.push({ organization_id: ORG_ID, dropdown_menu_id: insertedMenu.id, item_type: 'Material', material_id: matM.id, labor_rate_id: null, machine_rate_id: null, is_optional: false, sort_order: itemRows.length })
      else if (matL) itemRows.push({ organization_id: ORG_ID, dropdown_menu_id: insertedMenu.id, item_type: 'LaborRate', material_id: null, labor_rate_id: matL.id, machine_rate_id: null, is_optional: false, sort_order: itemRows.length })
      else if (matMc) itemRows.push({ organization_id: ORG_ID, dropdown_menu_id: insertedMenu.id, item_type: 'MachineRate', material_id: null, labor_rate_id: null, machine_rate_id: matMc.id, is_optional: false, sort_order: itemRows.length })
    }
    if (itemRows.length > 0) { const r = await sb.from('product_dropdown_items').insert(itemRows); if (r.error) throw new Error(`product_dropdown_items: ${r.error.message}`) }
  }

  return {
    modifierCount: modifierRows.length, defaultItemCount: defaultItemRows.length,
    optionRateCount: optionRateRows.length, dropdownMenuCount: dropdownMenus.length,
    unmatchedDefaultItems: (shopvox_data.default_items ?? []).filter((it) => {
      const key = lc(it.name); const kind = it.modal?.item_type ?? it.item_type
      if ((kind ?? '').toLowerCase().includes('material')) return !materialByName.has(key)
      if ((kind ?? '').toLowerCase().includes('labor')) return !laborByName.has(key)
      if ((kind ?? '').toLowerCase().includes('machine')) return !machineByName.has(key)
      return true
    }).map((it) => it.name),
  }
}

// Loads the existing output file (if any) and returns a Map keyed by
// shopvoxId, so this run's results MERGE into prior runs' instead of
// overwriting the whole file -- the bug that silently wiped item #1's
// entry when a later batch run's writeFileSync replaced the file
// wholesale. Checkpointed after every item below, same as
// scrape-shopvox-material-tiers.js's OUTPUT_FILE pattern, so a crash
// mid-run loses at most the item in flight.
function loadExistingResults() {
  try {
    const prior = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8'))
    return new Map(prior.map((r) => [r.shopvoxId, r]))
  } catch {
    return new Map()
  }
}

async function runCreateMode(page) {
  const resultsByShopvoxId = loadExistingResults()
  const saveCheckpoint = () => writeFileSync(OUTPUT_FILE, JSON.stringify([...resultsByShopvoxId.values()], null, 2))
  const results = []
  const record = (r) => { results.push(r); resultsByShopvoxId.set(r.shopvoxId, r); saveCheckpoint() }
  for (const shopvoxId of CREATE_IDS) {
    console.log(`\n${shopvoxId} — navigating to verify + read Basic Settings…`)
    let basic
    try {
      basic = await readBasicSettings(page, shopvoxId)
      if (!basic.name) throw new Error('no name found')
    } catch (e) {
      record({ shopvoxId, status: 'flagged', reason: `re-verify failed: ${e.message}` })
      console.log(`  -> flagged: ${e.message}`)
      continue
    }
    console.log(`  confirmed live: "${basic.name}"`)

    const advanced = await readAdvancedSettings(page, shopvoxId).catch((e) => { console.log(`  advanced settings read failed: ${e.message}`); return {} })

    let extracted
    try {
      extracted = await extractProduct(page, URLS.product(shopvoxId))
    } catch (e) {
      record({ shopvoxId, name: basic.name, status: 'flagged', reason: `recipe extraction failed: ${e.message}` })
      console.log(`  -> flagged: recipe extraction failed: ${e.message}`)
      await screenshot(page, `extract_fail_${basic.name}`)
      continue
    }

    const createResult = await createProductRecord(basic, advanced, extracted.pricing, INACTIVE_IDS.has(shopvoxId))
    if (createResult.status !== 'created') {
      record({ shopvoxId, name: basic.name, ...createResult })
      console.log(`  -> flagged: ${createResult.reason}`)
      continue
    }
    console.log(`  created products.id=${createResult.productId}${createResult.unresolvedRefs.length ? ` (unresolved refs: ${createResult.unresolvedRefs.join(', ')})` : ''}`)

    const shopvox_data = await writeShopvoxData(createResult.productId, basic, extracted)
    let relResult
    try {
      relResult = await populateRelationalTables(createResult.productId, shopvox_data)
    } catch (e) {
      record({ shopvoxId, name: basic.name, status: 'created_partial', productId: createResult.productId, unresolvedRefs: createResult.unresolvedRefs, error: `relational population failed: ${e.message}` })
      console.log(`  -> created but relational population FAILED: ${e.message}`)
      continue
    }

    await sb.from('products').update({ migration_status: 'in_progress', updated_by: CREATOR_ID }).eq('id', createResult.productId)

    record({
      shopvoxId, name: basic.name, status: 'created', productId: createResult.productId,
      active: !INACTIVE_IDS.has(shopvoxId), unresolvedRefs: createResult.unresolvedRefs,
      pricingType: extracted.pricing.pricing_type, ...relResult,
    })
    console.log(`  relational: ${relResult.modifierCount} modifiers, ${relResult.defaultItemCount} default items, ${relResult.dropdownMenuCount} dropdown menus, ${relResult.optionRateCount} option rates`)
    if (relResult.unmatchedDefaultItems.length) console.log(`  unmatched default items (no catalog match): ${relResult.unmatchedDefaultItems.join(', ')}`)
  }

  console.log('\n=========== CREATE RESULT ===========')
  console.log(JSON.stringify(results, null, 2))
  console.log(`\nWritten to ${OUTPUT_FILE}`)
  return results
}

async function main() {
  const { context } = await launchBrowser()
  const page = context.pages()[0] ?? (await context.newPage())
  await ensureLoggedIn(page)
  await runCreateMode(page)
  await context.close()
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })

// ShopVOX materials Pricing Matrix (quantity-break tier) scraper via Playwright.
//
// WHY THIS EXISTS: ShopVOX's per-material CSV export (Material_Export_
// List_*.csv, used by scripts/extract-shopvox-products.mjs) does NOT
// carry Pricing Matrix / quantity-break tier data — confirmed by
// inspecting the export format. Tiers live on a per-material sub-page
// (Pricing Matrix tab) and can only be read by visiting each material.
// "Allow Variants" on the material record is NOT a reliable signal for
// whether a material has tiers (confirmed: materials with real tier
// data have allow_variants=false, same as materials with none) — this
// script detects tier presence directly from the Pricing Matrix content
// instead of trusting that flag.
//
// Each material page also has a native "Export Pricing Matrix" button.
// Tried first, as the lower-risk option — it did not produce a
// downloadable file when clicked via automated browser control (no
// network request fired, nothing landed in Downloads), so this script
// (DOM extraction) is the confirmed working path, not just a fallback
// of convenience. A real human click might behave differently; worth
// re-testing manually before assuming it's unusable outright.
//
// HISTORY: the DOM-reading logic below (_extractPricingMatrix and the
// grid-structure notes above it) was originally written as a browser
// console / javascript_exec snippet and proven correct by live
// inspection against the 12mm and 9mm Cirrus LED panels and the flat
// Cellular Controller material. That extraction logic is unchanged
// here — only the *harness* around it changed. The original file had
// no Playwright/browser-launch scaffolding at all (it was never a
// standalone Node script — it relied on an external tool or a human
// pasting phases into DevTools one at a time), so `node
// scripts/scrape-shopvox-material-tiers.js` failed immediately with
// "document is not defined" at module load. This version wraps the
// same proven DOM logic in the Playwright harness shopvox-extract.mjs
// already uses (persistent session, manual login step, page.evaluate).
//
// Prerequisites:
//   npm install --save-dev playwright
//   npx playwright install chromium
//
// First run: a Chromium window opens, reusing the same persisted
// session as shopvox-extract.mjs (scripts/.shopvox-session/) — if
// you're already logged in from that script, you're logged in here too.
//
// Usage:
//   node scripts/scrape-shopvox-material-tiers.js                  # all materials
//   node scripts/scrape-shopvox-material-tiers.js --limit 3        # first 3 (smoke test)
//   node scripts/scrape-shopvox-material-tiers.js --uuids=1b2e5863-ba41-406a-8389-9c7cd26f4d91,86112df1-eeee-4200-9d86-56667339c9b2
//                                                                    # scoped run — skips discovery
//   node scripts/scrape-shopvox-material-tiers.js --resume          # skip already-scraped (default)
//   node scripts/scrape-shopvox-material-tiers.js --no-resume       # re-scrape everything
//   node scripts/scrape-shopvox-material-tiers.js --debug           # screenshot every step
//   node scripts/scrape-shopvox-material-tiers.js --cdp=http://localhost:9222  # attach to existing Chrome
//   node scripts/scrape-shopvox-material-tiers.js --no-images       # skip the image_url capture
//   node scripts/scrape-shopvox-material-tiers.js --reconcile-only  # re-run discovery + the new/deleted/status
//                                                                    # reconciliation report only — reuses the
//                                                                    # existing output.json's tier/vendor/image/
//                                                                    # field data as-is, no per-material re-scrape
//   --create-uuids=... has been REMOVED — see the "REMOVED" comment
//   above computeSourceHash(). It used to create PrintOS materials
//   directly; that write path no longer exists. Passing the flag now
//   errors out immediately with a pointer to the migrate screen.
//
// ============================================================
// REPOINTED 2026-08-21 (material redesign Build 1, item 10): this
// script no longer INSERTs or UPDATEs public.materials, material_
// vendors, or material_pricing_tiers, in any code path. Every scraped
// material is upserted into the new public.shopvox_materials staging
// table instead (see upsertShopvoxMaterialStaging), keyed by ShopVOX's
// own material uuid (organization_id, shopvox_id) — not name-matched.
// Real materials/material_vendors/material_pricing_tiers rows are only
// ever created by Ruben accepting a proposal on the migrate screen.
// scripts/import-material-tiers.mjs, which used to write
// material_pricing_tiers/material_vendors from this script's output
// file, has been repointed the same way — see that file's own header.
// Rationale (unchanged from the instruction that drove this): Ruben
// hand-enters shipping/min-max/shelf-life/delivery data with no ShopVOX
// source; an in-place scrape would silently destroy it. And once
// substrate families exist ("... NLC" instead of "... NLC 38in"), the
// old exact-name match would stop matching and re-create 1,788 flat
// materials from scratch instead of recognizing them as existing.
// ============================================================
//
// Output: scripts/shopvox-material-tiers-output.json — { tiered, flat, retry }
// — kept as a local run-log/checkpoint file (crash resume, --resume
// dedup), NOT the source of truth for staged data anymore; the real
// output of a run is what lands in shopvox_materials. Progress is
// checkpointed to the JSON file after every material, so a crash mid-run
// loses at most the material in flight; re-running with --resume (the
// default) picks up where it left off.
//
// IMAGE CAPTURE: reads each material's own photo from the "General"
// section of its detail page — the SAME page visit already made for
// tier/vendor extraction, no extra navigation. Written to PrintOS
// materials.image_url ONLY when that column is currently null/empty;
// never overwrites a real existing value. Disable with --no-images.
// NOT list-page-based — that approach was tried first and abandoned
// after a real, confirmed data-corruption incident (215 unrelated
// materials silently got the same wrong photo) and, even after fixing
// that bug, was found to be structurally limited anyway: ShopVOX's
// materials list only ever renders thumbnails for the small initial
// batch of rows (~50-102) shown before any "Load Remaining" click —
// confirmed live, no amount of waiting or scrolling changes that.
// ────────────────────────────────────────────────────────────────────────

const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } = require('node:fs')
const { resolve } = require('node:path')
const { createHash } = require('node:crypto')

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
const SCOPED_UUIDS = getFlag('--uuids') ? getFlag('--uuids').split(',').map((s) => s.trim()).filter(Boolean) : null
const RESUME = !hasFlag('--no-resume')   // resume is the default
const DEBUG = hasFlag('--debug')
const CDP_URL = getFlag('--cdp')
const NO_IMAGES = hasFlag('--no-images')
const NO_FIELDS = hasFlag('--no-fields') // skip the 39-field base-data diff/write, tier+vendor+image only
const RECONCILE_ONLY = hasFlag('--reconcile-only') // skip per-material extraction entirely — discovery + reconciliation report only, reusing the existing output.json
const CREATE_UUIDS = getFlag('--create-uuids') ? getFlag('--create-uuids').split(',').map((s) => s.trim()).filter(Boolean) : null // create new PrintOS materials for ShopVOX uuids confirmed to have no PrintOS counterpart

// ── Files ─────────────────────────────────────────────────────────────
const __dirname_ = __dirname
const repoRoot = resolve(__dirname_, '..')
const SESSION_DIR = resolve(__dirname_, '.shopvox-session') // shared with shopvox-extract.mjs
const DEBUG_DIR   = resolve(__dirname_, 'shopvox-debug')
const OUTPUT_FILE = resolve(__dirname_, 'shopvox-material-tiers-output.json')
const RECONCILIATION_FILE = resolve(__dirname_, 'shopvox-materials-reconciliation-report.json')

if (DEBUG && !existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true })

function loadJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
function saveJson(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2)) }

const output = RESUME
  ? loadJson(OUTPUT_FILE, { generatedAt: null, tiered: [], flat: [], retry: [] })
  : { generatedAt: null, tiered: [], flat: [], retry: [] }

// ── .env.local / Supabase — same loader as shopvox-extract.mjs ────────
function loadEnv() {
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
  return env
}

// Same pattern already used correctly in import-material-tiers.mjs —
// Supabase caps a single unpaginated request at 1,000 rows. A real
// incident (confirmed live, 2026-08-10): the reconciliation section
// below queried `materials` with no range/pagination at all, silently
// truncating PrintOS's real 1,764 materials to the first 1,000 —
// causing 787 real, already-imported materials to be reported as "new"
// and at least one confirmed-real status mismatch to be silently
// skipped from comparison entirely (fell into the truncated set, so
// "not found" → miscategorized as new instead of being compared).
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

const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
let sb = null
function getSupabase() {
  if (sb) return sb
  const env = loadEnv()
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('  (missing Supabase env vars — shopvox_materials staging writes disabled)')
    return null
  }
  sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  return sb
}

// ShopVOX's list-page thumbnails are served through a resize/crop
// transform (confirmed live: .../transform/output=jpg/rotate=deg:exif/
// resize=width:23,height:23,fit:crop/accounts/{id}/uploads/{file}) —
// strip that prefix to recover the original full-res asset URL, matching
// the shape already stored in materials.image_url from the CSV import
// (e.g. assets.shopvox.com/accounts/{id}/uploads/{file}).
function stripImageTransform(url) {
  if (!url) return null
  return url.replace(/\/transform\/.*?\/accounts\//, '/accounts/')
}

// ── REPOINTED (material redesign Build 1, item 10) ─────────────────────
// This used to write straight to materials.image_url (matched by exact
// case-insensitive name, only when the column was empty). That write is
// REMOVED — the scraper no longer touches public.materials at all. The
// captured URL is now just staged data; writeMaterialImageIfMissing is
// gone, replaced by this capture-only helper. Kept the name-stripping
// logic (stripImageTransform) since the staged value should still be
// the clean, non-transformed URL, matching what materials.image_url
// would have received before.
function captureMaterialImage(capturedUrl) {
  if (NO_IMAGES) return { image_url: null, note: 'skipped_flag' }
  if (!capturedUrl) return { image_url: null, note: 'no_image_found' } // confirmed live: this is the normal, correct outcome for most materials, not a failure
  return { image_url: stripImageTransform(capturedUrl), note: 'captured' }
}

// ── Base-field diff-and-write ───────────────────────────────────────
// Confirmed live (2026-08-10) against Acrylic Clear .220in with "Show
// All Information" expanded — 39 label/value fields. Mapped to
// materials columns below. Two fields are deliberately excluded from
// writes per explicit decision, not an oversight:
//   - COG Account: report-only. Confirmed live this can genuinely
//     differ from what PrintOS has (Acrylic Clear .220in shows empty
//     in ShopVOX right now vs. cog_account_number=5101 in PrintOS) —
//     but COG Account feeds QuickBooks export mapping, so an automated
//     "exact match" write here could break real accounting output.
//     Logged as a mismatch list for manual review, never auto-written.
//   - "Multiplier" (NOT "Multiplier (X)" — two distinct fields):
//     investigated, not understood well enough to map. Confirmed live
//     it's usually 1.0 but not always (found "Black / Trimp Cap" at
//     0.0) — the one confirmed differing case co-varies with
//     QuickBooks Item Type ("inventory_item" vs "non_inventory_item"),
//     not with the Cost/Price/Multiplier(X) pricing math (verified:
//     Price = Cost × Multiplier(X) holds regardless of this field's
//     value). Read and logged per material for future pattern-finding,
//     never written to any column.
const REFERENCE_CACHE = { materialTypes: null, materialCategories: null, discounts: null }
async function loadReferenceCaches(client) {
  if (REFERENCE_CACHE.materialTypes) return REFERENCE_CACHE
  const [{ data: types }, { data: cats }, { data: discs }] = await Promise.all([
    client.from('material_types').select('id, name').eq('organization_id', ORG_ID),
    client.from('material_categories').select('id, name').eq('organization_id', ORG_ID),
    client.from('discounts').select('id, name').eq('organization_id', ORG_ID),
  ])
  REFERENCE_CACHE.materialTypes = new Map((types ?? []).map((t) => [t.name.toLowerCase().trim(), t.id]))
  REFERENCE_CACHE.materialCategories = new Map((cats ?? []).map((c) => [c.name.toLowerCase().trim(), c.id]))
  REFERENCE_CACHE.discounts = new Map((discs ?? []).map((d) => [d.name.toLowerCase().trim(), d.id]))
  return REFERENCE_CACHE
}

// Runs inside page.evaluate. Reads every field visible once "Show All
// Information" is expanded, by exact label text — confirmed live, not
// positional/guessed. Robust to fields that don't apply to a given
// material's Type (e.g. "Sheet Width" vs "Roll Width") — reads
// whichever labels are actually present, doesn't assume a fixed set.
function _extractAllMaterialFields() {
  const get = (labelText) => {
    const p = Array.from(document.querySelectorAll('p')).find((el) => el.innerText.trim() === labelText)
    if (!p) return undefined
    const container = p.parentElement?.parentElement
    const span = container?.querySelector('span:last-of-type') || container?.querySelector('span')
    const t = (span?.innerText ?? container?.innerText?.replace(labelText, ''))?.trim()
    return t === '' ? null : t
  }
  // Confirmed live (real bug caught 2026-08-10 in first verification
  // run): "Preferred Vendor" renders a colored code badge ("AC") plus
  // the real name in a `.ml4` div, same pattern already confirmed for
  // the Vendor Price grid's own Vendor column — the generic get() above
  // grabbed both concatenated ("AC\nA&C Plastics"). Target the `.ml4`
  // name specifically; fall back to the generic read for materials with
  // no vendor set (no badge markup renders at all in that case).
  const getVendorName = (labelText) => {
    const p = Array.from(document.querySelectorAll('p')).find((el) => el.innerText.trim() === labelText)
    if (!p) return undefined
    const container = p.parentElement?.parentElement
    const nameDiv = container?.querySelector('.ml4')
    if (nameDiv) { const t = nameDiv.innerText.trim(); return t === '' ? null : t }
    return get(labelText)
  }
  return {
    type: get('Type'),
    category: get('Category'),
    preferred_vendor: getVendorName('Preferred Vendor'),
    external_name: get('External Name'),
    selling_units: get('Selling Units'),
    buying_units: get('Buying Units'),
    sell_buy_ratio: get('Sell/Buy Ratio (Sqft/Sheet)') ?? get('Sell/Buy Ratio (Feet/Roll)') ?? get('Sell/Buy Ratio (Sqft/Roll)'),
    width: get('Sheet Width') ?? get('Roll Width'),
    height: get('Sheet Height') ?? get('Roll Length') ?? get('Roll Height'),
    sheet_cost: get('Sheet Cost') ?? get('Roll Cost'),
    part_number: get('Part Number'),
    sku: get('SKU'),
    weight: get('Weight'),
    cost: get('Cost'),
    multiplier: get('Multiplier (X)'),
    price: get('Price'),
    setup_charge: get('Setup Charge'),
    labor_charge: get('Labor Charge'),
    machine_charge: get('Machine Charge'),
    other_charge: get('Other Charge'),
    formula: get('Formula'),
    discount: get('Discount'),
    include_in_base_price: get('Include in Base Price'),
    mystery_multiplier: get('Multiplier'), // NOT written anywhere — read/logged only, see comment above
    qb_item_type: get('QuickBooks Item Type'),
    cog_account: get('COG Account'), // NOT written — report-only, see comment above
    per_li_unit: get('Per LI Unit'),
    calculate_wastage: get('Calculate Wastage'),
    fixed_side: get('Fixed Side'),
    wastage_markup: get('Wastage Markup (X)'),
    description: get('Description'),
    display_name_in_line_item: get('Display Name in Line Item Description'),
    display_description_in_li: get('Display Description in Line Item Description'),
    po_description: get('PO Description'),
    print_image_on_pdf: get('Print Image on PDF'),
    info_url: get('Info URL'),
    show_internal: get('Show Internal'),
  }
}

// Runs inside page.evaluate. "Show All Information" is a collapsed-by-
// default toggle — click it if not already expanded (button text flips
// to "Show Overview Only" once expanded; don't double-click and
// collapse it back).
function _clickShowAllInformation() {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('Show All Information'))
  if (btn) { btn.click(); return true }
  return false
}

const YES_NO = { yes: true, no: false }
function parseBool(v) { if (v == null) return null; const t = String(v).trim().toLowerCase(); return t in YES_NO ? YES_NO[t] : null }
function parseNum(v) { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }

// Maps ShopVOX's 39 confirmed fields to materials-shaped column names —
// now consumed only by resolveShopVoxFields on the way into
// shopvox_materials staging (the update/create paths that used to share
// this are both removed, see the "REMOVED"/"REPOINTED" comments below).
// Still returns only the 37 write-eligible fields (39 minus COG Account
// minus mystery Multiplier — both staged separately, report-only, never
// mapped to a dedicated column). `undefined` in the output means "a name
// lookup (Type/Category/Discount) didn't resolve" — surfaced via
// resolveShopVoxFields's unresolvedRefs; `null` means "ShopVOX genuinely
// shows this blank."
function buildCandidateFromShopVoxFields(sv, refs) {
  const typeId = sv.type ? refs.materialTypes.get(sv.type.toLowerCase().trim()) : undefined
  const categoryId = sv.category ? refs.materialCategories.get(sv.category.toLowerCase().trim()) : undefined
  const discountId = sv.discount && sv.discount !== '-' ? refs.discounts.get(sv.discount.toLowerCase().trim()) : null
  return {
    material_type_id: sv.type ? (typeId ?? undefined) : null,
    category_id: sv.category ? (categoryId ?? undefined) : null,
    preferred_vendor: sv.preferred_vendor,
    external_name: sv.external_name,
    selling_units: sv.selling_units,
    buying_units: sv.buying_units,
    sell_buy_ratio: parseNum(sv.sell_buy_ratio),
    width: parseNum(sv.width),
    height: parseNum(sv.height),
    sheet_cost: parseNum(sv.sheet_cost),
    part_number: sv.part_number,
    sku: sv.sku,
    weight: parseNum(sv.weight),
    cost: parseNum(sv.cost),
    multiplier: parseNum(sv.multiplier), // "Multiplier (X)" — the real pricing multiplier, distinct from the unmapped mystery field
    price: parseNum(sv.price),
    setup_charge: parseNum(sv.setup_charge),
    labor_charge: parseNum(sv.labor_charge),
    machine_charge: parseNum(sv.machine_charge),
    other_charge: parseNum(sv.other_charge),
    formula: sv.formula,
    discount_id: sv.discount === '-' ? null : (discountId ?? undefined),
    discount: sv.discount === '-' ? null : sv.discount,
    include_in_base_price: parseBool(sv.include_in_base_price),
    qb_item_type: sv.qb_item_type,
    per_li_unit: sv.per_li_unit,
    calculate_wastage: parseBool(sv.calculate_wastage),
    fixed_side: sv.fixed_side,
    wastage_markup: parseNum(sv.wastage_markup),
    description: sv.description,
    display_name_in_line_item: parseBool(sv.display_name_in_line_item),
    display_description_in_li: parseBool(sv.display_description_in_li),
    po_description: sv.po_description,
    print_image_on_pdf: parseBool(sv.print_image_on_pdf),
    info_url: sv.info_url,
    show_internal: parseBool(sv.show_internal),
  }
}

// ── REPOINTED (material redesign Build 1, item 10) ─────────────────────
// This used to diff the confirmed 39 fields against the live PrintOS
// materials row and UPDATE whatever changed. That write is REMOVED —
// the scraper no longer reads OR writes public.materials at all
// (previously it read the row to diff against; now it doesn't need to,
// since there's nothing to diff against — the staged row in
// shopvox_materials just gets the latest scrape's values, full stop,
// and CHANGED-vs-MIGRATED is derived later by comparing source_hash,
// not by a field-by-field diff at scrape time).
//
// Renamed from diffAndWriteMaterialFields to make the new behavior
// honest: this only resolves ShopVOX's raw label/value fields into
// typed values (parsing numbers/booleans, looking up material_type_id/
// category_id/discount_id) — it does not diff or write anything.
// Kept the boolean-string normalization comment for history even though
// the bug it guarded against (comparing against a live row) no longer
// applies here.
function resolveShopVoxFields(sv, refs) {
  if (NO_FIELDS) return { skipped: 'flag' }
  const candidate = buildCandidateFromShopVoxFields(sv, refs)
  const unresolvedRefs = Object.entries(candidate)
    .filter(([, v]) => v === undefined)
    .map(([col]) => col)
  return {
    candidate,
    unresolvedRefs,
    cogAccountShopVox: sv.cog_account || null, // report-only field, staged as-is inside `fields`, never written to a dedicated materials column (unchanged decision from before this repoint)
    mysteryMultiplier: sv.mystery_multiplier,
  }
}

// ── REMOVED (material redesign Build 1, item 10) ───────────────────────
// createMaterialFromShopVox used to INSERT a brand-new materials row
// directly for any ShopVOX material with no PrintOS name-match. That
// write is REMOVED along with it — the scraper must never create a
// materials row. An unmatched ShopVOX material now simply lands in
// shopvox_materials with migrated_to_material_id NULL (status = NEW),
// same as every other unmigrated row — Ruben creates the real material
// by accepting its proposal on the migrate screen, same path as
// everything else, not a separate create-mode shortcut. This is also
// the fix for the exact failure mode the rationale in item 10 called
// out: once families exist ("... NLC" not "... NLC 38in"), name-match
// creation would insert a duplicate flat material instead of recognizing
// it as a variant of an existing family — removing name-match creation
// entirely removes that failure mode, it doesn't just reduce it.
//
// The --create-uuids flag and runCreateMode() below are removed with it
// — see main() for the flag now erroring out with a pointer to the
// migrate screen instead of silently doing nothing.

// Computes a deterministic hash of everything staged for one ShopVOX
// material — the CHANGED-vs-MIGRATED signal on shopvox_materials
// (migration 179). Must be a pure function of the payload only (no
// timestamps inside it) so re-scraping unchanged data reproduces the
// exact same hash.
function computeSourceHash(payload) {
  const stable = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(stable).digest('hex')
}

// Upserts one material's full staged capture into shopvox_materials,
// keyed on (organization_id, shopvox_id) — the ONLY table this script
// writes to as of this repoint. Never touches materials, material_
// vendors, or material_pricing_tiers.
async function upsertShopvoxMaterialStaging(staged) {
  const client = getSupabase()
  if (!client) return { status: 'no_client' }

  const hashPayload = {
    name: staged.name, shopvox_status: staged.shopvox_status,
    material_type_raw: staged.material_type_raw, category_raw: staged.category_raw,
    width: staged.width, height: staged.height, sheet_cost: staged.sheet_cost,
    cost: staged.cost, price: staged.price, multiplier: staged.multiplier, weight: staged.weight,
    preferred_vendor: staged.preferred_vendor, part_number: staged.part_number, sku: staged.sku,
    po_description: staged.po_description, info_url: staged.info_url, image_url: staged.image_url,
    description: staged.description, fields: staged.fields,
    vendor_pricing: staged.vendor_pricing, pricing_tiers: staged.pricing_tiers,
  }
  const source_hash = computeSourceHash(hashPayload)

  const row = {
    organization_id: ORG_ID,
    shopvox_id: staged.shopvox_id,
    name: staged.name,
    shopvox_status: staged.shopvox_status,
    material_type_id: staged.material_type_id ?? null,
    category_id: staged.category_id ?? null,
    material_type_raw: staged.material_type_raw ?? null,
    category_raw: staged.category_raw ?? null,
    width: staged.width ?? null,
    height: staged.height ?? null,
    sheet_cost: staged.sheet_cost ?? null,
    cost: staged.cost ?? null,
    price: staged.price ?? null,
    multiplier: staged.multiplier ?? null,
    weight: staged.weight ?? null,
    preferred_vendor: staged.preferred_vendor ?? null,
    part_number: staged.part_number ?? null,
    sku: staged.sku ?? null,
    po_description: staged.po_description ?? null,
    info_url: staged.info_url ?? null,
    image_url: staged.image_url ?? null,
    description: staged.description ?? null,
    fields: staged.fields ?? {},
    vendor_pricing: staged.vendor_pricing ?? [],
    pricing_tiers: staged.pricing_tiers ?? [],
    source_hash,
    scraped_at: new Date().toISOString(),
  }

  const { data, error } = await client
    .from('shopvox_materials')
    .upsert(row, { onConflict: 'organization_id,shopvox_id' })
    .select('id, status')
    .maybeSingle()
  if (error) return { status: 'write_error', error: error.message }
  return { status: 'staged', id: data?.id, derivedStatus: data?.status, source_hash }
}

// ── URLs ─────────────────────────────────────────────────────────────
const URLS = {
  materialsList: 'https://express.shopvox.com/settings/pricing/materials',
  materialPricingMetrics: (uuid) => `https://express.shopvox.com/settings/pricing/materials/${uuid}/pricing-metrics`,
}

// ── Helpers ───────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function screenshot(page, label) {
  if (!DEBUG) return
  const safe = label.replace(/[^\w-]+/g, '_').slice(0, 80)
  const path = resolve(DEBUG_DIR, `${Date.now()}_${safe}.png`)
  try { await page.screenshot({ path, fullPage: true }) } catch {}
}

// ── PHASE 1 — MATERIAL DISCOVERY ────────────────────────────────────
// Repeatedly clicks "Load N Remaining" until the full list is rendered,
// then collects material name/uuid/imageUrl from the list page rows.
// Same detection logic as the original console snippet — just driven
// from Node instead of a setTimeout-recursion inside the page.
//
// ROOT CAUSE of a real incident (Ruben ran this standalone, got
// "discovered 0 materials, 0 with an image" after 122.8s, no error, and
// the sign-in check below didn't fire — session cookies were confirmed
// present and valid afterward): this function used to jump straight
// into the click-loop with NO wait for the page to have actually
// rendered ANY content first — no material links, no Load-Remaining
// button. Every other DOM-reading step in this file
// (extractOneMaterial's waitForFunction on "Pricing Matrix" text,
// extractVendorPricingSameVisit's header-wrapper wait) waits for a
// real content signal before reading; this one didn't. On a slow
// Ember-app cold start (compiling routes, first API round-trip) it's
// entirely plausible to check before ANYTHING has rendered: the
// click-loop's first read finds no Load button (none has rendered
// yet either) and exits immediately, then the link read finds 0 —
// silently, no error, exactly matching the incident. This is the same
// class of race already found and fixed once today for Vendor Price
// row population (header renders before row data does); it just hadn't
// been checked here yet.
// Confirmed live (2026-08-10): the materials list has a per-account
// persisted "System View" selector (Enabled / Disabled, both built-in
// and lock-protected) plus an editable "My View" — restored via a
// `?view=...` URL param on every navigation. NEVER trust whatever's
// currently showing: during this same investigation the persisted view
// silently drifted to "Disabled" (~139 materials) between one check and
// the next — a "full" discovery run under that drifted state would have
// silently scraped only the tiny disabled subset instead of the full
// ~1,750-material active catalog, with no error at all. Always
// explicitly force-select the desired view first.
//
// This is also the confirmed real signal for active/disabled status
// (tested directly against a known-disabled material: present under
// "Disabled", absent under both "Enabled" and "My View") — there is no
// single view showing both statuses together, so a genuine reconciliation
// pass needs to run discovery once per view and tag accordingly.
async function selectMaterialsView(page, viewName) {
  const opened = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /^(Disabled|Enabled|My View)$/.test(b.innerText.trim()))
    if (btn) { btn.click(); return true }
    return false
  })
  if (!opened) {
    await screenshot(page, 'view_selector_not_found')
    throw new Error('Materials view-selector button not found — ShopVOX UI may have changed. Check a screenshot.')
  }
  await sleep(800)
  const selected = await page.evaluate((name) => {
    const opt = Array.from(document.querySelectorAll('*')).find((el) => el.children.length === 0 && el.innerText?.trim() === name)
    if (opt) { opt.click(); return true }
    return false
  }, viewName)
  if (!selected) {
    await screenshot(page, `view_option_${viewName}_not_found`)
    throw new Error(`Could not find "${viewName}" option in the view-selector dropdown. Check a screenshot.`)
  }
  await sleep(2500) // let the fresh view's data start loading before the content-wait below picks it up
}

async function discoverMaterials(page, viewName = 'Enabled') {
  // Sign-in redirects land here (session cookie expired, no material
  // rows will ever appear) — fail loudly instead of silently returning
  // an empty queue, which is what happened before this check existed.
  if (/\/sign-in/i.test(page.url())) {
    throw new Error(`Not signed in — page redirected to ${page.url()}. Log into ShopVOX in the open Chromium window and re-run.`)
  }

  await selectMaterialsView(page, viewName)
  console.log(`  forced materials view: ${viewName}`)

  // Wait for SOME real content — either a material link or the
  // Load-Remaining button — before doing anything else. Without this,
  // an empty/still-loading page and a genuinely-broken page look
  // identical to the code below.
  try {
    await page.waitForFunction(() => {
      const hasLink = document.querySelectorAll('a[href*="/settings/pricing/materials/"]').length > 0
      const hasLoadBtn = Array.from(document.querySelectorAll('*'))
        .some((el) => el.children.length === 0 && el.innerText?.includes('Load') && el.innerText?.includes('Remaining'))
      return hasLink || hasLoadBtn
    }, { timeout: 30000 })
  } catch {
    await screenshot(page, 'discover_no_content_timeout')
    throw new Error(
      `Materials list never rendered any content after 30s (url: ${page.url()}). ` +
      `Not signed in silently, or ShopVOX is slow/broken right now — check ${DEBUG ? DEBUG_DIR : '--debug for a screenshot next time'}.`
    )
  }
  await screenshot(page, 'discover_content_ready')

  console.log('Discovering materials (clicking "Load Remaining" until exhausted)…')
  const MAX_LOAD_CLICKS = 10           // one click loads everything, confirmed live — generous ceiling, not an expected-normal count
  const LOAD_GROWTH_TIMEOUT_MS = 60000 // confirmed live: a real ~1,650-material load took ~14s; 60s gives ~4x margin

  // ROOT CAUSE of a second real incident (discovery stopped at 50 — the
  // page's first-render batch — instead of the full ~1,764, with no
  // error) — confirmed by direct live reproduction, not guessed:
  //
  //   1. The "Load Remaining" button vanishes from the DOM THE INSTANT
  //      it's clicked (an optimistic UI change) — confirmed live: 0s
  //      after click, button is already gone. This happens whether or
  //      not the underlying bulk fetch actually starts/succeeds, so
  //      "button disappeared" is NOT a valid completion signal — an
  //      earlier fix attempt treated it as one and broke on exactly
  //      this data point (it read the vanished button as "the click
  //      worked" after checking only ~4-9s in, before real data had
  //      arrived).
  //   2. The real signal is the link count actually growing. Confirmed
  //      live: after clicking, link count sat flat at 102 for a full
  //      14 seconds before jumping to 3,398 (≈1,699 unique materials
  //      after dedup) in one batch — matching the historical "1,698
  //      discovered" successful runs exactly. A few seconds of polling
  //      is nowhere near enough; this needs real patience.
  //
  // Fix: poll link-count growth directly, with a timeout well past the
  // observed real load time, and don't treat button-vanishing as
  // meaningful either way.
  let clickCount = 0
  let linkCount = await page.evaluate(() => document.querySelectorAll('a[href*="/settings/pricing/materials/"]').length)
  console.log(`  initial link count: ${linkCount}`)

  const readButtonText = () => {
    const btn = Array.from(document.querySelectorAll('*'))
      .find((el) => el.children.length === 0 && el.innerText?.includes('Load') && el.innerText?.includes('Remaining'))
    return btn ? btn.innerText.trim() : null
  }

  for (;;) {
    // Poll up to 5s for the button before concluding the list is fully
    // loaded — guards against checking in the gap between links
    // rendering and the button itself rendering.
    let btnText = null
    for (let i = 0; i < 5 && btnText === null; i++) {
      btnText = await page.evaluate(readButtonText)
      if (btnText === null) await sleep(1000)
    }
    if (btnText === null) {
      console.log(`  no "Load Remaining" button after ${clickCount} click(s) — list fully loaded (${linkCount} links)`)
      break
    }

    console.log(`  click #${clickCount + 1}: "${btnText}" (${linkCount} links so far)`)
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('*'))
        .find((el) => el.children.length === 0 && el.innerText?.includes('Load') && el.innerText?.includes('Remaining'))
      btn?.click()
    })

    const pollStart = Date.now()
    let grew = false
    while (Date.now() - pollStart < LOAD_GROWTH_TIMEOUT_MS) {
      await sleep(2000)
      const newLinkCount = await page.evaluate(() => document.querySelectorAll('a[href*="/settings/pricing/materials/"]').length)
      if (newLinkCount > linkCount) {
        console.log(`    → grew to ${newLinkCount} links after ${((Date.now() - pollStart) / 1000).toFixed(1)}s`)
        linkCount = newLinkCount
        grew = true
        break
      }
    }

    if (!grew) {
      await screenshot(page, `discover_click_stuck_${clickCount}`)
      throw new Error(
        `"Load Remaining" click (was "${btnText}") produced no link-count growth after ${LOAD_GROWTH_TIMEOUT_MS / 1000}s ` +
        `(stuck at ${linkCount} links). The button vanishing on click is normal and NOT evidence anything worked — this ` +
        `means the underlying bulk fetch genuinely never completed. Check the screenshot.`
      )
    }

    clickCount++
    if (clickCount >= MAX_LOAD_CLICKS) {
      await screenshot(page, 'discover_load_click_ceiling')
      throw new Error(`"Load Remaining" click loop hit ${MAX_LOAD_CLICKS} clicks without exhausting — likely stuck clicking something that isn't working. Check a screenshot.`)
    }
  }

  await screenshot(page, 'discover_before_link_read')

  // Discovery only collects name/uuid now — image capture moved to the
  // per-material page visit (see _extractMaterialImage / material_image
  // handling in extractOneMaterial). HISTORY: an earlier version tried
  // pairing each row with a thumbnail <img> right here on the list page,
  // climbing up from each material's <a> link. That caused a real,
  // confirmed data-corruption incident — climbing far enough to span
  // multiple rows made querySelector return the FIRST image anywhere in
  // an oversized subtree, not the row's own image, silently writing 215
  // unrelated materials the exact same wrong photo. Even after fixing
  // that climb-bound, the approach was structurally limited anyway:
  // confirmed live that ShopVOX's materials list only ever renders
  // thumbnails for the small initial batch of rows shown before any
  // "Load Remaining" click (~50-102 materials) — never for anything
  // pulled in afterward, no matter how long you wait or scroll. Reading
  // images from each material's own detail page (already visited for
  // tier/vendor data) doesn't have either problem.
  const queue = await page.evaluate(() => {
    const linkSelector = 'a[href*="/settings/pricing/materials/"]'
    const links = Array.from(document.querySelectorAll(linkSelector))
    const rows = links
      .map((l) => ({
        name: l.innerText.trim(),
        uuid: l.href.match(/materials\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1],
      }))
      .filter((r) => r.uuid && r.name)
    const seen = new Set()
    return rows.filter((r) => { if (seen.has(r.uuid)) return false; seen.add(r.uuid); return true })
  })

  // The definitive backstop: zero discovered materials is NEVER a valid
  // success, no matter what caused it. Whatever the root cause on any
  // given run — logged out, redirect race, ShopVOX outage, a selector
  // that stopped matching after a redesign — silently returning an
  // empty queue is strictly worse than failing loudly, because it looks
  // identical to "this org genuinely has 0 materials" (never true here).
  if (queue.length === 0) {
    await screenshot(page, 'discover_zero_materials')
    throw new Error(
      `Discovered 0 materials at ${page.url()} despite content being present moments ago — this should never happen. ` +
      `Re-run with --debug and check the screenshots in ${DEBUG_DIR}.`
    )
  }

  const shopvoxStatus = viewName === 'Disabled' ? 'disabled' : 'enabled'
  for (const m of queue) m.shopvoxStatus = shopvoxStatus

  console.log(`  discovered ${queue.length} materials (view: ${viewName})`)
  return queue
}

// ── PHASE 2 — PER-MATERIAL EXTRACTION ───────────────────────────────
// Locates the "Variant and Prices" grid and extracts rows.
//
// IMPORTANT — confirmed by live DOM inspection (javascript_exec against
// the 12mm and 9mm Cirrus panels and the flat Cellular Controller), NOT
// assumed: this grid is NOT a semantic <table>. It's a CSS-module div
// grid (root class matches `_tableExcel_*`), and each cell's real value
// lives in an <input> element (it's an inline-editable spreadsheet grid)
// — reading .innerText on the cell returns an EMPTY STRING even when the
// cell clearly shows a value on screen, because input values aren't part
// of the accessibility/text tree. Must read `input.value` directly.
//
// Structure (root → wrapper → [headerWrapper, contentWrapper]):
//   [class*="_tableExcel_"]            root
//     [child 0]                       wrapper
//       [child 0]                     headerWrapper ("From Qty", "To Qty", "Cost", "Price"...)
//       [child 1]                     contentWrapper (the data rows)
//         [class*="_rowComponent_"]   one per tier row
//           [class*="_contentCell_"]  one per column; cell 0=From Qty, 1=To Qty, 2=Cost, 3=Price
//
// Class names are CSS-module hashes (e.g. `_headerCell_12otk_49`) that
// could change on a ShopVOX redeploy — this is exactly the kind of
// fragility flagged going in. Matched by stable *prefix* substrings
// (`_tableExcel_`, `_rowComponent_`, `_contentCell_`) rather than full
// hashed names, which is the most resilient anchor available without
// access to ShopVOX's source. If ShopVOX ships a redesign, this will
// need re-verifying the same way it was built: live DOM inspection
// against a real material page, not guessing.
//
// Runs inside page.evaluate — must be self-contained (no closures over
// outer Node variables).
function _extractPricingMatrix() {
  const root = document.querySelector('[class*="_tableExcel_"]')
  if (!root) {
    return { found: false, reason: 'no_grid_root' }
  }

  const headerText = root.innerText || ''
  if (!/From Qty/i.test(headerText) || !/To Qty/i.test(headerText)) {
    return { found: false, reason: 'grid_missing_from_to_headers' }
  }

  // Flat materials render this exact grid with "No records." in place
  // of rows (confirmed live against Digital LED Screen Cellular
  // Controller- Cirrus, which has no Pricing Matrix data in ShopVOX).
  if (/No records\.?/i.test(root.innerText)) {
    return { found: true, flat: true, tiers: [] }
  }

  const wrapper = root.children[0]
  const body = wrapper?.children[1]
  if (!body) {
    return { found: true, flat: false, tiers: [], error: 'no_body_wrapper' }
  }

  const rows = Array.from(body.querySelectorAll('[class*="_rowComponent_"]'))
  const num = (s) => {
    const n = parseFloat((s || '').replace(/[$,]/g, ''))
    return isNaN(n) ? null : n
  }
  const cellValue = (cell) => {
    const input = cell?.querySelector('input, textarea')
    return (input ? input.value : cell?.innerText || '').trim()
  }

  const tiers = rows
    .map((r) => {
      const cells = Array.from(r.querySelectorAll('[class*="_contentCell_"]'))
      const fromRaw = cellValue(cells[0])
      const toRaw = cellValue(cells[1])
      return {
        from_qty: num(fromRaw),
        to_qty: toRaw === '' || /^n\/?a$/i.test(toRaw) ? null : num(toRaw),
        cost: num(cellValue(cells[2])),
        price: num(cellValue(cells[3])),
      }
    })
    .filter((t) => t.from_qty !== null && t.price !== null)

  return { found: true, flat: tiers.length === 0, tiers }
}

// ── PHASE 2b — VENDOR PRICING ───────────────────────────────────────
// Reads the "Vendor Price" tab — confirmed live against a real populated
// material (Acrylic Clear .220in, 4 rows, 3 distinct vendors) via
// page.evaluate against the actual page, not reasoned from markup alone.
//
// Same underlying grid component as _extractPricingMatrix (root class
// `_wrapper_12otk_1`, header `_headerWrapper_12otk_108`, rows
// `_rowComponent_12otk_*`, cells `_contentCell_12otk_*` — the exact
// `_headerCell_12otk_49` hash already cited in _extractPricingMatrix's
// own comments as an example, so this is the same reusable ShopVOX grid,
// just a different table instance). Unlike the Pricing Matrix grid,
// values here are plain text content, not <input> values — confirmed by
// reading real captured output, no input.value workaround needed.
//
// Each cell carries a `header="ColumnName"` attribute naming its own
// column — read that way instead of positional indexing, which is more
// resilient to column reordering than _extractPricingMatrix's cells[0]/
// cells[1]/... approach.
//
// One real-data finding that overturns an assumption made before this
// was verified: the same vendor can appear on more than one row at
// different prices/ranks (confirmed live: "Grimco" appeared twice, rank
// 2 at $118.20 and rank 3 at $96.31) — so (material_id, vendor_name) is
// NOT a safe unique key on its own; rank (or just no uniqueness
// constraint at all, keeping every row) is needed to distinguish them.
function _extractVendorPricing() {
  const headerWrapper = document.querySelector('[class*="_headerWrapper_12otk_"]')
  if (!headerWrapper) return { found: false, reason: 'no_grid_root' }
  const root = headerWrapper.parentElement
  const content = root.children[1]
  if (!content) return { found: true, rows: [] }
  const rowEls = Array.from(content.querySelectorAll('[class*="_rowComponent_"]'))

  const num = (s) => {
    const n = parseFloat((s || '').replace(/[$,]/g, ''))
    return isNaN(n) ? null : n
  }
  const text = (row, header) => {
    const cell = row.querySelector(`[header="${header}"]`)
    const t = (cell?.innerText || '').trim()
    return t === '' ? null : t
  }

  const rows = rowEls.map((row) => {
    // Vendor cell nests a colored code badge + full name in a `.ml4`
    // div — take the full name, falling back to raw cell text if
    // ShopVOX's markup for this cell ever changes shape.
    const vendorCell = row.querySelector('[header="Vendor"]')
    const vendorName = vendorCell?.querySelector('.ml4')?.innerText?.trim() || text(row, 'Vendor')
    // Image column can hold a real <img> or (confirmed live: all 4 rows
    // on the test material) just a placeholder SVG icon when no image
    // is set for that vendor-price row — only capture a real <img>.
    const imgCell = row.querySelector('[header="Image"] img')

    return {
      quantity: num(text(row, 'Quantity')),
      price: num(text(row, 'Price')),
      rank: num(text(row, 'Rank')),
      part_number: text(row, 'Part Number'),
      part_name: text(row, 'Part Name'),
      units: text(row, 'Units'),
      info_url: text(row, 'Info Url'),
      width: num(text(row, 'Width')),
      length: num(text(row, 'Length')),
      sqft_price: num(text(row, 'Sqft Price')),
      vendor_name: vendorName || null,
      delivery_fee: num(text(row, 'Delivery Fee In Dollars')),
      image_url: imgCell ? imgCell.src : null,
    }
  })

  return { found: true, rows }
}

// Best-effort material-name lookup for scoped (--uuids=) runs, where
// discovery never ran and the queue has no name — only the raw UUID.
// Unlike _extractPricingMatrix (confirmed live against real pages),
// this selector cascade is a best-effort guess, following the same
// "try increasingly generic candidates, first non-empty wins" pattern
// shopvox-extract.mjs uses for modal headings. If ShopVOX's layout
// doesn't match any of these, the caller keeps the UUID as name —
// no worse than before this fix, never a fatal error.
function _extractMaterialName() {
  const candidates = ['h1', '[class*="pageTitle"]', '[class*="PageTitle"]', '[class*="heading"]', 'h2']
  for (const sel of candidates) {
    const el = document.querySelector(sel)
    const t = (el?.innerText || '').trim()
    if (t) return t
  }
  return (document.title || '').trim() || null
}

// Reads a material's own photo from the "General" section at the top of
// its detail page — confirmed live (2026-08-10) against a material known
// to have one (Acrylic Clear .220in — 1/4", correctly returned its real
// photo) and, separately, against 27 materials sampled from the
// currently-null pool (12 hand-picked "likely to have a photo" plus 15
// evenly spread across the full null set) — all 27 correctly returned
// null: no `[class*="_material_"]` wrapper renders at all when a
// material has no photo (confirmed: only the empty "Choose Files / Or
// Drag & Drop Here" dropzone shows, same `_1epec_` CSS-module family as
// the Vendor Price grid's own per-row Image column). This section
// renders on page load, before any tab click — no extra interaction
// needed beyond the existing page.goto this function already does for
// tier/vendor extraction.
function _extractMaterialImage() {
  const wrapper = document.querySelector('[class*="_material_"]')
  const img = wrapper?.querySelector('img')
  return img?.src ?? null
}

async function extractOneMaterial(page, material) {
  await page.goto(URLS.materialPricingMetrics(material.uuid), { waitUntil: 'domcontentloaded', timeout: 30000 })

  try {
    await page.waitForFunction(() => document.body.innerText.includes('Pricing Matrix'), { timeout: 25000 })
  } catch {
    return { uuid: material.uuid, name: material.name, scrapedAt: new Date().toISOString(), found: false, needs_retry: true, reason: 'page_load_timeout' }
  }

  // Scoped (--uuids=) runs seed name = uuid (no discovery page visited).
  // Now that we're on the material's own page, try to recover the real
  // name before falling back to the uuid placeholder.
  let name = material.name
  if (name === material.uuid) {
    const found = await page.evaluate(_extractMaterialName).catch(() => null)
    if (found) name = found
  }

  await screenshot(page, `material_${name}`)
  const extraction = await page.evaluate(_extractPricingMatrix)
  const vendorPricing = await extractVendorPricingSameVisit(page)

  // Same page, no extra navigation — the General section's own photo is
  // already rendered above the tab bar regardless of which tab is active.
  const capturedImageUrl = await page.evaluate(_extractMaterialImage).catch(() => null)
  const imageCapture = captureMaterialImage(capturedImageUrl) // no longer writes — see captureMaterialImage's header comment

  // Base fields — "Show All Information" is on the General section,
  // also already present on this same page, also no extra navigation.
  let fieldResolution = { skipped: 'flag' }
  if (!NO_FIELDS) {
    await page.evaluate(_clickShowAllInformation)
    await sleep(1200) // confirmed live: fields render a beat after the toggle click, same class of race as the tier/vendor grids
    const rawFields = await page.evaluate(_extractAllMaterialFields).catch(() => null)
    const client = getSupabase()
    if (rawFields && client) {
      const refs = await loadReferenceCaches(client)
      fieldResolution = { ...resolveShopVoxFields(rawFields, refs), rawFields }
    } else if (!rawFields) {
      fieldResolution = { error: 'field_extraction_failed' }
    } else {
      fieldResolution = { skipped: 'no_client', rawFields }
    }
  }

  // ── Stage into shopvox_materials (item 10: the ONLY table this
  // script writes to). Replaces the old writeMaterialImageIfMissing /
  // diffAndWriteMaterialFields / createMaterialFromShopVox writes to
  // materials / material_vendors / material_pricing_tiers.
  let stagingResult = { status: 'skipped_no_fields' }
  if (fieldResolution.candidate) {
    const c = fieldResolution.candidate
    stagingResult = await upsertShopvoxMaterialStaging({
      shopvox_id: material.uuid,
      name,
      shopvox_status: material.shopvoxStatus ?? null,
      material_type_id: c.material_type_id,
      category_id: c.category_id,
      material_type_raw: fieldResolution.rawFields?.type ?? null,
      category_raw: fieldResolution.rawFields?.category ?? null,
      width: c.width, height: c.height, sheet_cost: c.sheet_cost,
      cost: c.cost, price: c.price, multiplier: c.multiplier, weight: c.weight,
      preferred_vendor: c.preferred_vendor, part_number: c.part_number, sku: c.sku,
      po_description: c.po_description, info_url: c.info_url,
      image_url: imageCapture.image_url,
      description: c.description,
      fields: fieldResolution.rawFields ?? {},
      vendor_pricing: vendorPricing?.rows ?? [],
      pricing_tiers: extraction?.tiers ?? [],
    })
  }

  return {
    uuid: material.uuid, name, scrapedAt: new Date().toISOString(),
    ...extraction, vendor_pricing: vendorPricing,
    material_image: { captured: capturedImageUrl, ...imageCapture },
    field_resolution: fieldResolution,
    staging: stagingResult,
    // Confirmed gap (2026-08-10): discoverMaterials() tags shopvoxStatus
    // on each queue item in-memory, but this returned record never
    // carried it through into what actually gets checkpointed to
    // OUTPUT_FILE — so status-mismatch reconciliation had no persisted
    // data to read and required a live re-discovery pass every time.
    // Persisting it now so future runs' output.json is self-sufficient.
    shopvoxStatus: material.shopvoxStatus ?? null,
  }
}

// Vendor Price lives on the material's base route (a sibling tab), not
// the /pricing-metrics sub-route _extractPricingMatrix reads — but both
// are reachable from the SAME page.goto (confirmed live: the Vendor
// Price tab link is present in the shared layout even while sitting on
// /pricing-metrics). Clicking it does an in-app Ember route swap, not a
// fresh navigation, so this stays within "the existing per-material page
// visit" rather than adding a second one.
async function extractVendorPricingSameVisit(page) {
  const clicked = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('*'))
      .find((e) => e.children.length === 0 && e.innerText?.trim() === 'Vendor Price')
    if (el) { el.click(); return true }
    return false
  })
  if (!clicked) return { found: false, reason: 'vendor_price_tab_not_found' }

  try {
    await page.waitForFunction(() => !!document.querySelector('[class*="_headerWrapper_12otk_"]'), { timeout: 15000 })
  } catch {
    return { found: false, reason: 'vendor_grid_load_timeout' }
  }

  // Confirmed live (real bug caught during build, not theoretical): the
  // header renders immediately but row data is a separate async fetch
  // that lands ~500ms later — 0 rows measured at +0ms, 4/4 by +500ms,
  // stable at +1000ms/+2000ms. A fixed settle wait here, not just
  // waiting for the header, or every material would read as "0 vendor
  // prices" regardless of its real data.
  await sleep(1500)

  const result = await page.evaluate(_extractVendorPricing)
  // Strip the same list-thumbnail transform prefix as the discovery
  // image_url, defensively — untested against a real populated Image
  // cell (all 4 test rows had none), but harmless no-op if the shape
  // differs.
  if (result.found && Array.isArray(result.rows)) {
    for (const r of result.rows) r.image_url = stripImageTransform(r.image_url)
  }
  return result
}

function classify(record) {
  // A reprocessed material (most importantly: one being retried out of
  // the retry bucket) must end up in exactly ONE bucket afterward, not
  // accumulate a stale duplicate in whichever bucket it used to be in.
  // Without this, a retry-bucket material that now succeeds would sit
  // in both `retry` AND `tiered`/`flat` at once — corrupting both the
  // output counts and any future `alreadyDone` resume check.
  for (const bucket of [output.tiered, output.flat, output.retry]) {
    const idx = bucket.findIndex((r) => r.uuid === record.uuid)
    if (idx >= 0) bucket.splice(idx, 1)
  }
  if (!record.found) { output.retry.push({ ...record, needs_retry: true }); return 'retry' }
  if (record.flat) { output.flat.push(record); return 'flat' }
  output.tiered.push(record)
  return 'tiered'
}

// ── Browser setup — identical pattern to shopvox-extract.mjs ───────
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

async function ensureLoggedIn(page) {
  await page.goto(URLS.materialsList, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {})

  console.log('\n────────────────────────────────────────────────────────')
  console.log('  MANUAL STEP — in the open Chromium window:')
  console.log('    1. Log into ShopVOX if not already logged in')
  console.log(`       (session is shared with shopvox-extract.mjs — already logged in there? you're set)`)
  console.log(`    2. Navigate to ${URLS.materialsList}`)
  console.log('  Then press ENTER here to continue.')
  console.log('  (No timeout — the script will wait as long as you need.)')
  console.log('────────────────────────────────────────────────────────\n')

  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  await new Promise((res) => process.stdin.once('data', () => res()))
  process.stdin.pause()

  // Re-navigate and confirm the session actually took — a stale/expired
  // ShopVOX cookie silently redirects to /sign-in, and without this
  // check discoverMaterials() would just report "0 materials queued"
  // with no indication why (this happened during development: the
  // persisted session had expired mid-build with no auth cookie left).
  //
  // A SINGLE immediate check here is not enough — confirmed live in a
  // separate incident the same day this was first written: the
  // client-side auth-check-then-redirect can lag a moment after
  // domcontentloaded, so an immediate read can catch the URL BEFORE the
  // redirect fires and false-pass. Require 2 consecutive not-signed-in
  // reads, 5s apart, before trusting it — same fix already proven
  // necessary once today for an equivalent race elsewhere.
  await page.goto(URLS.materialsList, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {})
  let confirmedLoggedIn = false
  let consecutiveOk = 0
  for (let i = 0; i < 3; i++) {
    if (/\/sign-in/i.test(page.url())) {
      consecutiveOk = 0
    } else {
      consecutiveOk++
      if (consecutiveOk >= 2) { confirmedLoggedIn = true; break }
    }
    await sleep(5000)
  }
  if (!confirmedLoggedIn) {
    console.error(`\n✗ Still on the sign-in page (${page.url()}) — login didn't take. Log in fully, then re-run.`)
    process.exit(1)
  }
}

// ── Main ──────────────────────────────────────────────────────────────
// runCreateMode / --create-uuids REMOVED (material redesign Build 1,
// item 10) — it used to call createMaterialFromShopVox, which INSERTed
// straight into public.materials. See the "REMOVED" comment above
// computeSourceHash for why that write path is gone for good, not just
// disabled. A ShopVOX material with no PrintOS match now stages into
// shopvox_materials via the normal per-material pipeline (status = NEW)
// and gets created for real only by accepting its proposal on the
// migrate screen.

async function main() {
  const startAt = Date.now()

  if (CREATE_UUIDS) {
    console.error('\n✗ --create-uuids has been removed. The scraper no longer creates materials rows directly (material redesign Build 1, item 10) — it only stages into shopvox_materials. Create the material by accepting its NEW proposal on the migrate screen instead.')
    process.exit(1)
  }

  const { context } = await launchBrowser()
  const page = context.pages()[0] ?? (await context.newPage())
  page.on('console', (msg) => { if (msg.type() === 'log') console.log('  BROWSER:', msg.text()) })

  let queue
  if (SCOPED_UUIDS) {
    console.log(`Scoped run: ${SCOPED_UUIDS.length} material UUID(s) given, skipping discovery.`)
    queue = SCOPED_UUIDS.map((uuid) => ({ uuid, name: uuid }))
  } else {
    await ensureLoggedIn(page)
    // Dual-view discovery: "Enabled" (the real active catalog, ~1,750)
    // and "Disabled" (~139) are the only two system views, and neither
    // shows both — confirmed live. Running discovery once per view and
    // tagging accordingly is required for genuine new/deleted/status
    // reconciliation across the WHOLE catalog, not just active materials.
    const enabledQueue = await discoverMaterials(page, 'Enabled')
    const disabledQueue = await discoverMaterials(page, 'Disabled')
    const seen = new Set()
    queue = [...enabledQueue, ...disabledQueue].filter((m) => { if (seen.has(m.uuid)) return false; seen.add(m.uuid); return true })
    console.log(`Combined: ${enabledQueue.length} enabled + ${disabledQueue.length} disabled = ${queue.length} total ShopVOX materials.\n`)
  }

  if (LIMIT) queue = queue.slice(0, LIMIT)

  // ROOT CAUSE of a real incident (confirmed live, not assumed): this
  // used to pool ALL three buckets — including `retry` — into
  // "already done," so the 1,529 materials sitting in retry from an
  // earlier browser-collision incident were treated as finished and
  // silently skipped on every subsequent run, across several re-runs in
  // a row. `retry` means "needs another attempt," not "done" — only
  // `tiered`/`flat` (genuine successes) should ever be skipped on
  // resume.
  const alreadyDone = new Set([...output.tiered, ...output.flat].map((r) => r.uuid))
  const todo = RECONCILE_ONLY ? [] : (RESUME ? queue.filter((m) => !alreadyDone.has(m.uuid)) : queue)
  if (RECONCILE_ONLY) {
    console.log(`--reconcile-only: skipping per-material extraction entirely (tier/vendor/image/field data from the prior run is reused as-is). Queue: ${queue.length} total ShopVOX materials for the reconciliation comparison.\n`)
  } else {
    console.log(`Queue: ${queue.length} total, ${queue.length - todo.length} already done (resume), ${todo.length} to process (includes ${output.retry.length} pending retries).\n`)
  }

  let processed = 0
  for (const material of todo) {
    try {
      const record = await extractOneMaterial(page, material)
      const bucket = classify(record)
      processed++
      console.log(`  [${processed}/${todo.length}] ${material.name} → ${bucket}`)
    } catch (e) {
      output.retry.push({ uuid: material.uuid, name: material.name, needs_retry: true, reason: e instanceof Error ? e.message : String(e) })
      console.log(`  [${processed + 1}/${todo.length}] ${material.name} → ERROR: ${e instanceof Error ? e.message : e}`)
    }
    output.generatedAt = new Date().toISOString()
    saveJson(OUTPUT_FILE, output) // checkpoint after every material
  }

  // ── Reconciliation report — new/deleted materials, status mismatches,
  // COG Account mismatches, mystery-Multiplier log. All report-only:
  // nothing here is auto-created, auto-deleted, or auto-written — same
  // caution as the products-orphan process this mirrors.
  let reconciliation = null
  if (!SCOPED_UUIDS) {
    console.log('\nBuilding reconciliation report…')
    const client = getSupabase()
    const printosMaterials = client
      ? await fetchAllRows((from, to) =>
          client.from('materials').select('id, name, active, in_use, cog_account_name').eq('organization_id', ORG_ID).order('id', { ascending: true }).range(from, to)
        )
      : []
    const printosByName = new Map(printosMaterials.map((m) => [m.name.toLowerCase().trim(), m]))
    const shopvoxByName = new Map(queue.map((m) => [m.name.toLowerCase().trim(), m]))

    const newMaterials = queue
      .filter((m) => !printosByName.has(m.name.toLowerCase().trim()))
      .map((m) => ({ name: m.name, uuid: m.uuid, shopvoxStatus: m.shopvoxStatus }))

    const deletedMaterials = printosMaterials
      .filter((m) => !shopvoxByName.has(m.name.toLowerCase().trim()))
      .map((m) => ({ id: m.id, name: m.name }))

    // Confirmed live: "active" tracks much closer to ShopVOX's real
    // Enabled/Disabled than "in_use" does (84 vs. 1,082 false, out of
    // ~1,764 — "in_use" looks like it tracks something else entirely,
    // maybe "has this ever been used on a job"). Comparing against
    // "active"; "in_use" reported alongside for Ruben's own judgment.
    const statusMismatches = []
    for (const m of queue) {
      const printosRow = printosByName.get(m.name.toLowerCase().trim())
      if (!printosRow) continue // already captured as "new" above
      const shopvoxEnabled = m.shopvoxStatus === 'enabled'
      if (printosRow.active !== shopvoxEnabled) {
        statusMismatches.push({ name: m.name, shopvoxStatus: m.shopvoxStatus, printosActive: printosRow.active, printosInUse: printosRow.in_use })
      }
    }

    // COG Account mismatches + non-default mystery-Multiplier sightings —
    // gathered from every material actually processed this run.
    // REPOINTED (item 10): this used to read rec.field_diff, produced by
    // diffAndWriteMaterialFields's live per-material read/write. That
    // function is gone — cogMismatch is now computed here instead, a
    // read-only lookup against the already-fetched printosByName map
    // (no write, same as the rest of this reconciliation section always
    // was). mysteryMultiplier comes from field_resolution, unchanged in
    // meaning, just renamed.
    const cogMismatches = []
    const mysteryMultiplierLog = []
    for (const rec of [...output.tiered, ...output.flat]) {
      const shopvoxCog = rec.field_resolution?.cogAccountShopVox ?? null
      const printosRow = printosByName.get((rec.name || '').toLowerCase().trim())
      const printosCog = printosRow?.cog_account_name ?? null
      if (rec.field_resolution?.rawFields && (shopvoxCog ?? '') !== (printosCog ?? '')) {
        cogMismatches.push({ name: rec.name, shopvox: shopvoxCog, printos: printosCog })
      }
      const mm = rec.field_resolution?.mysteryMultiplier
      if (mm != null && mm !== '1.0') {
        mysteryMultiplierLog.push({ name: rec.name, value: mm })
      }
    }

    reconciliation = {
      generatedAt: new Date().toISOString(),
      shopvoxTotal: queue.length,
      printosTotal: printosMaterials.length,
      newMaterials,
      deletedMaterials,
      statusMismatches,
      cogAccountMismatches: cogMismatches,
      mysteryMultiplierNonDefault: mysteryMultiplierLog,
    }
    saveJson(RECONCILIATION_FILE, reconciliation)
    console.log(`  new: ${newMaterials.length}, deleted: ${deletedMaterials.length}, status mismatches: ${statusMismatches.length}, COG mismatches: ${cogMismatches.length}, non-default Multiplier sightings: ${mysteryMultiplierLog.length}`)
    console.log(`Reconciliation report written to ${RECONCILIATION_FILE}`)
  }

  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1)
  console.log('\n=========== RESULT ===========')
  console.log(JSON.stringify({ tiered: output.tiered.length, flat: output.flat.length, needs_retry: output.retry.length, elapsedSeconds: elapsed }, null, 2))
  console.log(`Output written to ${OUTPUT_FILE}`)

  await context.close()
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})

// Maps a row from a ShopVOX product export CSV onto the shape we insert into
// the `products` table. Pure functions, used by client preview + server
// import action. Mirrors lib/material-import-mapper.ts.

const NORMALIZE_RE = /\s+/g
function norm(s: string): string {
  return s.trim().toLowerCase().replace(NORMALIZE_RE, ' ')
}

// ShopVOX header → logical key. Logical keys are referenced by buildRow
// below; the actual DB column name is decided there.
const HEADER_MAP: Record<string, string | null> = {
  'product name': 'name',
  'name': 'name',
  'product description': 'description',
  'description': 'description',
  'category': 'category_name',
  'pricing type': 'pricing_type',
  'formula': 'formula',
  'cost': 'cost',
  'price': 'price',
  'markup (x)': 'markup',
  'markup': 'markup',
  'workflow template': 'workflow_template_name',
  'workflow': 'workflow_template_name',
  'active': 'active',
  'published': 'published',
  'units': 'units',
  'selling units': 'units',
  'buying units': 'buying_units',
  'part number': 'part_number',
  'sku': 'sku',
  'image url': 'image_url',
  'product type': 'product_type',
  'type': 'product_type',
  'secondary category': 'secondary_category',
  'min line price': 'min_line_price',
  'min unit price': 'min_unit_price',
  'taxable': 'taxable',
  'show feet inches': 'show_feet_inches',
  'show feet/inches': 'show_feet_inches',
  'production details': 'production_details',
  // Ignored — DB has its own timestamps & user FKs we can't fill from a name
  'created at': null,
  'created by': null,
  'updated at': null,
  'updated by': null,
}

export type HeaderResolution = {
  index: Record<string, number>
  unmappedHeaders: string[]
}

export function resolveHeaders(headerRow: string[]): HeaderResolution {
  const index: Record<string, number> = {}
  const unmapped: string[] = []
  headerRow.forEach((raw, i) => {
    const key = HEADER_MAP[norm(raw)]
    if (key === undefined) unmapped.push(raw)
    else if (key !== null && index[key] === undefined) {
      // First match wins — protects against e.g. both "Cost" and "Cost ($)"
      // appearing in the same export.
      index[key] = i
    }
  })
  return { index, unmappedHeaders: unmapped }
}

// ─── Value coercers ─────────────────────────────────────────────────────────

function get(row: string[], i: number | undefined): string {
  if (i === undefined || i < 0 || i >= row.length) return ''
  return row[i] ?? ''
}

function parseBool(v: string): boolean | null {
  const s = v.trim().toLowerCase()
  if (s === '' || s === 'n/a' || s === '--') return null
  if (s === 'yes' || s === 'true' || s === '1' || s === 'y') return true
  if (s === 'no' || s === 'false' || s === '0' || s === 'n') return false
  return null
}

function parseNum(v: string): number | null {
  const s = v.trim().replace(/[$,\s]/g, '')
  if (s === '' || s.toLowerCase() === 'n/a' || s === '--') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function parseStr(v: string): string | null {
  const s = v.trim()
  return s === '' ? null : s
}

// Coerce free text into one of the allowed pricing_type CHECK values.
function parsePricingType(v: string): 'Formula' | 'Basic' | 'Grid' | 'Cost Plus' {
  const s = v.trim().toLowerCase()
  if (s.includes('basic')) return 'Basic'
  if (s.includes('grid')) return 'Grid'
  if (s.includes('cost')) return 'Cost Plus'
  return 'Formula' // safe default — matches DB default
}

// ─── Row builder ────────────────────────────────────────────────────────────

export type ProductImportRow = {
  name: string
  description: string | null
  category_name: string | null
  pricing_type: 'Formula' | 'Basic' | 'Grid' | 'Cost Plus'
  formula: string | null
  cost: number
  price: number
  markup: number
  workflow_template_name: string | null
  active: boolean
  published: boolean
  units: string | null
  buying_units: string | null
  part_number: string | null
  sku: number | null
  image_url: string | null
  product_type: string | null
  secondary_category: string | null
  min_line_price: number | null
  min_unit_price: number | null
  taxable: boolean
  show_feet_inches: boolean
  production_details: string | null
}

export function buildRow(headerIndex: Record<string, number>, row: string[]): ProductImportRow {
  const get_ = (k: string) => get(row, headerIndex[k])

  // SKU column in DB is numeric(20,0); coerce best-effort and drop letters.
  let sku: number | null = null
  const skuRaw = get_('sku').trim().replace(/[^0-9]/g, '')
  if (skuRaw.length > 0 && skuRaw.length <= 18) {
    const n = Number(skuRaw)
    if (Number.isFinite(n)) sku = n
  }

  return {
    name: get_('name').trim(),
    description: parseStr(get_('description')),
    category_name: parseStr(get_('category_name')),
    pricing_type: parsePricingType(get_('pricing_type')),
    formula: parseStr(get_('formula')),
    cost: parseNum(get_('cost')) ?? 0,
    price: parseNum(get_('price')) ?? 0,
    markup: parseNum(get_('markup')) ?? 2.0,
    workflow_template_name: parseStr(get_('workflow_template_name')),
    active: parseBool(get_('active')) ?? true,
    published: parseBool(get_('published')) ?? false,
    units: parseStr(get_('units')),
    buying_units: parseStr(get_('buying_units')),
    part_number: parseStr(get_('part_number')),
    sku,
    image_url: parseStr(get_('image_url')),
    product_type: parseStr(get_('product_type')),
    secondary_category: parseStr(get_('secondary_category')),
    min_line_price: parseNum(get_('min_line_price')),
    min_unit_price: parseNum(get_('min_unit_price')),
    taxable: parseBool(get_('taxable')) ?? true,
    show_feet_inches: parseBool(get_('show_feet_inches')) ?? true,
    production_details: parseStr(get_('production_details')),
  }
}

// Display map for the preview UI — friendly DB column label.
const LOGICAL_TO_DB: Record<string, string> = {
  category_name: 'category_id (lookup)',
  workflow_template_name: 'workflow_template_id (lookup)',
}

export function buildHeaderMappingPreview(
  headerRow: string[],
): { csvHeader: string; dbColumn: string | null }[] {
  return headerRow.map((raw) => {
    const k = HEADER_MAP[norm(raw)]
    if (k === undefined) return { csvHeader: raw, dbColumn: null }
    if (k === null) return { csvHeader: raw, dbColumn: '(ignored)' }
    return { csvHeader: raw, dbColumn: LOGICAL_TO_DB[k] ?? k }
  })
}

// Maps a row from a ShopVOX "Material Export List" CSV onto the shape we
// insert into the `materials` table. Pure functions — used by both the
// client (for the preview table) and the server import action.
//
// Source CSV headers are normalized (trim + lowercase + collapse whitespace)
// before lookup so trivial export inconsistencies (e.g. trailing spaces on
// "Cost ", leading space on " Width") don't break the mapping.

const NORMALIZE_RE = /\s+/g
function norm(s: string): string {
  return s.trim().toLowerCase().replace(NORMALIZE_RE, ' ')
}

// ShopVOX column → logical key. Logical keys are referenced by the row
// builder below; the DB column name is decided there.
const HEADER_MAP: Record<string, string> = {
  'name': 'name',
  'cost': 'cost',
  'price': 'price',
  'multiplier (x)': 'multiplier',
  'multiplier': 'multiplier_alt', // ShopVOX exports two — see note in builder
  'type': 'type_name',
  'category': 'category_name',
  'description': 'description',
  'display name in line item description': 'display_name_in_line_item',
  'per li unit': 'per_li_unit',
  'buying units': 'buying_units',
  'fixed side': 'fixed_side',
  'formula': 'formula',
  'sheet cost': 'sheet_cost',
  'height': 'height',
  'width': 'width',
  'selling units': 'selling_units',
  'wastage markup (x)': 'wastage_markup',
  'weight': 'weight',
  'weight uom': 'weight_uom',
  'allow variants': 'allow_variants',
  'sell/buy ratio': 'sell_buy_ratio',
  'calculate wastage': 'calculate_wastage',
  'in use': 'in_use',
  'info url': 'info_url',
  'labor charge': 'labor_charge',
  'machine charge': 'machine_charge',
  'other charge': 'other_charge',
  'setup charge': 'setup_charge',
  'part number': 'part_number',
  'po description': 'po_description',
  'show internal': 'show_internal',
  'sku': 'sku',
  'fixed quantity': 'fixed_quantity',
  'preferred vendor': 'preferred_vendor',
  'cog account number': 'cog_account_number',
  'cog account name': 'cog_account_name',
  'discount': 'discount',
  'external name': 'external_name',
  'track inventory': 'track_inventory',
  'image url': 'image_url',
  'include in base price': 'include_in_base_price',
  'percentage of base': 'percentage_of_base',
  'active': 'active',
  // Ignored on purpose — DB has its own timestamps & user FKs we can't fill
  // from a name string.
  'created at': null as unknown as string,
  'created by': null as unknown as string,
  'updated at': null as unknown as string,
  'updated by': null as unknown as string,
}

export type HeaderResolution = {
  // Index in the CSV row for each logical key (or -1 if missing)
  index: Record<string, number>
  unmappedHeaders: string[]
}

export function resolveHeaders(headerRow: string[]): HeaderResolution {
  const index: Record<string, number> = {}
  const unmapped: string[] = []
  headerRow.forEach((raw, i) => {
    const key = HEADER_MAP[norm(raw)]
    if (key === undefined) unmapped.push(raw)
    else if (key !== null) index[key] = i
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

function parseInt0(v: string): number | null {
  const n = parseNum(v)
  if (n === null) return null
  return Math.trunc(n)
}

function parseStr(v: string): string | null {
  const s = v.trim()
  return s === '' ? null : s
}

// ─── Row builder ────────────────────────────────────────────────────────────

// Shape that the server action expects. Type/category come across as text
// names — the server resolves them to FK ids (auto-creating missing ones).
export type MaterialImportRow = {
  name: string
  external_name: string | null
  description: string | null
  po_description: string | null
  type_name: string | null
  category_name: string | null
  cost: number
  price: number
  multiplier: number
  buying_units: string | null
  selling_units: string | null
  sell_buy_ratio: number | null
  per_li_unit: string | null
  formula: string | null
  width: number | null
  height: number | null
  fixed_side: string | null
  fixed_quantity: number | null
  sheet_cost: number | null
  wastage_markup: number | null
  calculate_wastage: boolean
  allow_variants: boolean
  weight: number | null
  weight_uom: string | null
  labor_charge: number | null
  machine_charge: number | null
  other_charge: number | null
  setup_charge: number | null
  cog_account_number: number | null
  cog_account_name: string | null
  part_number: string | null
  sku: string | null
  preferred_vendor: string | null
  info_url: string | null
  image_url: string | null
  include_in_base_price: boolean
  percentage_of_base: number | null
  track_inventory: boolean
  in_use: boolean
  active: boolean
  show_internal: boolean
}

export function buildRow(headerIndex: Record<string, number>, row: string[]): MaterialImportRow {
  const get_ = (k: string) => get(row, headerIndex[k])

  return {
    name: get_('name').trim(),
    external_name: parseStr(get_('external_name')),
    description: parseStr(get_('description')),
    po_description: parseStr(get_('po_description')),
    type_name: parseStr(get_('type_name')),
    category_name: parseStr(get_('category_name')),

    cost: parseNum(get_('cost')) ?? 0,
    price: parseNum(get_('price')) ?? 0,
    // ShopVOX exports both "Multiplier (X)" and a plain "Multiplier".
    // The (X) one is the price multiplier — fall back to the plain column.
    multiplier:
      parseNum(get_('multiplier')) ??
      parseNum(get_('multiplier_alt')) ??
      2.0,

    buying_units: parseStr(get_('buying_units')),
    selling_units: parseStr(get_('selling_units')),
    sell_buy_ratio: parseNum(get_('sell_buy_ratio')),
    per_li_unit: parseStr(get_('per_li_unit')),
    formula: parseStr(get_('formula')),

    width: parseNum(get_('width')),
    height: parseNum(get_('height')),
    fixed_side: parseStr(get_('fixed_side')),
    fixed_quantity: parseNum(get_('fixed_quantity')),
    sheet_cost: parseNum(get_('sheet_cost')),

    wastage_markup: parseNum(get_('wastage_markup')),
    calculate_wastage: parseBool(get_('calculate_wastage')) ?? false,
    allow_variants: parseBool(get_('allow_variants')) ?? false,

    weight: parseNum(get_('weight')),
    weight_uom: parseStr(get_('weight_uom')),

    labor_charge: parseNum(get_('labor_charge')),
    machine_charge: parseNum(get_('machine_charge')),
    other_charge: parseNum(get_('other_charge')),
    setup_charge: parseNum(get_('setup_charge')),

    cog_account_number: parseInt0(get_('cog_account_number')),
    cog_account_name: parseStr(get_('cog_account_name')),

    part_number: parseStr(get_('part_number')),
    sku: parseStr(get_('sku')),
    preferred_vendor: parseStr(get_('preferred_vendor')),

    info_url: parseStr(get_('info_url')),
    image_url: parseStr(get_('image_url')),
    include_in_base_price: parseBool(get_('include_in_base_price')) ?? false,
    percentage_of_base: parseNum(get_('percentage_of_base')),

    track_inventory: parseBool(get_('track_inventory')) ?? false,
    in_use: parseBool(get_('in_use')) ?? true,
    active: parseBool(get_('active')) ?? true,
    show_internal: parseBool(get_('show_internal')) ?? false,
  }
}

// Quick preview helper — list of [csvHeader, dbColumn] pairs in the order
// the headers appear in the CSV. Used by the preview UI to render the
// mapping table next to the file's column order.
export function buildHeaderMappingPreview(
  headerRow: string[],
): { csvHeader: string; dbColumn: string | null }[] {
  return headerRow.map((raw) => {
    const k = HEADER_MAP[norm(raw)]
    if (k === undefined) return { csvHeader: raw, dbColumn: null } // unknown
    if (k === null) return { csvHeader: raw, dbColumn: '(ignored)' }
    return { csvHeader: raw, dbColumn: LOGICAL_TO_DB[k] ?? k }
  })
}

// Display label for the preview table — friendly DB column name.
const LOGICAL_TO_DB: Record<string, string> = {
  type_name: 'material_type_id (lookup)',
  category_name: 'category_id (lookup)',
  display_name_in_line_item: 'display_name_in_line_item',
  multiplier_alt: '(fallback for multiplier)',
}

// Maps a row from a ShopVOX "Machine Rate Export List" CSV onto the shape we
// insert into the `machine_rates` table. Pure functions — used by both the
// client (for the preview table) and the server import action.
//
// Source CSV headers are normalized (trim + lowercase + collapse whitespace)
// before lookup so trivial export inconsistencies (e.g. trailing spaces on
// "Cost ") don't break the mapping.
//
// NOTE: the machine_rates table does NOT have a `machine_charge` column
// (only `labor_charge`), so the CSV "Machine Charge" column is intentionally
// ignored.

const NORMALIZE_RE = /\s+/g
function norm(s: string): string {
  return s.trim().toLowerCase().replace(NORMALIZE_RE, ' ')
}

const HEADER_MAP: Record<string, string> = {
  'name': 'name',
  'cost': 'cost',
  'price': 'price',
  'markup(x)': 'markup',
  'markup (x)': 'markup',
  'markup': 'markup',
  'formula': 'formula',
  'units': 'units',
  'setup charge': 'setup_charge',
  'labor charge': 'labor_charge',
  'machine charge': 'machine_charge',
  'other charge': 'other_charge',
  'include in base price': 'include_in_base_price',
  'per li unit': 'per_li_unit',
  'cog account': 'cog_account',
  'cog account name': 'cog_account',
  'description': 'description',
  'display name in li description': 'display_name',
  'display name in line item description': 'display_name',
  'show internal': 'show_internal',
  'external name': 'external_name',
  'active': 'active',
  // Ignored on purpose — DB has its own timestamps & user FKs we can't fill
  // from a name string.
  'created at': null as unknown as string,
  'created by': null as unknown as string,
  'updated at': null as unknown as string,
  'updated by': null as unknown as string,
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

function parseStr(v: string): string | null {
  const s = v.trim()
  return s === '' ? null : s
}

// ─── Row builder ────────────────────────────────────────────────────────────

export type MachineRateImportRow = {
  name: string
  external_name: string | null
  cost: number
  price: number
  markup: number
  formula: string | null
  units: string | null
  setup_charge: number | null
  labor_charge: number | null
  machine_charge: number | null
  other_charge: number | null
  include_in_base_price: boolean
  per_li_unit: boolean
  cog_account: string | null
  description: string | null
  display_name: string | null
  show_internal: boolean
  active: boolean
}

export function buildRow(headerIndex: Record<string, number>, row: string[]): MachineRateImportRow {
  const get_ = (k: string) => get(row, headerIndex[k])

  return {
    name: get_('name').trim(),
    external_name: parseStr(get_('external_name')),
    cost: parseNum(get_('cost')) ?? 0,
    price: parseNum(get_('price')) ?? 0,
    markup: parseNum(get_('markup')) ?? 1,
    formula: parseStr(get_('formula')),
    units: parseStr(get_('units')),
    setup_charge: parseNum(get_('setup_charge')),
    labor_charge: parseNum(get_('labor_charge')),
    machine_charge: parseNum(get_('machine_charge')),
    other_charge: parseNum(get_('other_charge')),
    include_in_base_price: parseBool(get_('include_in_base_price')) ?? false,
    per_li_unit: parseBool(get_('per_li_unit')) ?? false,
    cog_account: parseStr(get_('cog_account')),
    description: parseStr(get_('description')),
    display_name: parseStr(get_('display_name')),
    show_internal: parseBool(get_('show_internal')) ?? false,
    active: parseBool(get_('active')) ?? true,
  }
}

export function buildHeaderMappingPreview(
  headerRow: string[],
): { csvHeader: string; dbColumn: string | null }[] {
  return headerRow.map((raw) => {
    const k = HEADER_MAP[norm(raw)]
    if (k === undefined) return { csvHeader: raw, dbColumn: null }
    if (k === null) return { csvHeader: raw, dbColumn: '(ignored)' }
    return { csvHeader: raw, dbColumn: k }
  })
}

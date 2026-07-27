// Maps a row from a customer CSV export onto the shape we insert into the
// `customers` table. Pure functions — used by client preview + server action.
// Mirrors lib/product-import-mapper.ts.

const NORMALIZE_RE = /\s+/g
function norm(s: string): string {
  return s.trim().toLowerCase().replace(NORMALIZE_RE, ' ')
}

// CSV header (normalised) → logical key.
// null = explicitly ignored (no DB column).
// undefined (missing key) = unmapped.
const HEADER_MAP: Record<string, string | null> = {
  // Company
  'company': 'company_name',
  'company name': 'company_name',
  'business': 'company_name',
  'business name': 'company_name',
  'organization': 'company_name',
  'organisation': 'company_name',
  // Name
  'first name': 'first_name',
  'first': 'first_name',
  'given name': 'first_name',
  'last name': 'last_name',
  'last': 'last_name',
  'surname': 'last_name',
  'family name': 'last_name',
  // Contact
  'email': 'email',
  'email address': 'email',
  'e-mail': 'email',
  'phone': 'phone',
  'phone number': 'phone',
  'mobile': 'phone',
  'cell': 'phone',
  'telephone': 'phone',
  'phone 2': 'phone2',
  'phone2': 'phone2',
  'alt phone': 'phone2',
  'alternative phone': 'phone2',
  'ext': 'phone_ext',
  'ext.': 'phone_ext',
  'extension': 'phone_ext',
  'phone ext': 'phone_ext',
  'phone extension': 'phone_ext',
  'website': 'website',
  'web': 'website',
  'web site': 'website',
  'url': 'website',
  // Primary address
  'address': 'street',
  'street': 'street',
  'address 1': 'street',
  'street address': 'street',
  'address 2': 'street2',
  'street 2': 'street2',
  'suite': 'street2',
  'apt': 'street2',
  'city': 'city',
  'state': 'state',
  'state/province': 'state',
  'province': 'state',
  'zip': 'zip',
  'zip code': 'zip',
  'postal code': 'zip',
  'post code': 'zip',
  'country': 'country',
  // Account
  'status': 'status',
  'industry': 'industry',
  'lead source': 'lead_source',
  'source': 'lead_source',
  'pricing level': 'pricing_level',
  'price level': 'pricing_level',
  'terms': 'terms',
  'payment terms': 'terms',
  'credit limit': 'credit_limit',
  'taxable': 'taxable',
  'tax exempt code': 'tax_exempt_code',
  'tax rate': 'tax_rate',
  'vat number': 'vat_number',
  'vat': 'vat_number',
  // Notes / misc
  'tags': 'tags',
  'notes': 'notes',
  'background': 'background_info',
  'background info': 'background_info',
  'special notes': 'special_notes',
  'ap contact': 'ap_contact',
  // Ignored — DB generates these
  'id': null,
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
      index[key] = i
    }
  })
  return { index, unmappedHeaders: unmapped }
}

// ── Value coercers ────────────────────────────────────────────────────────────

function get(row: string[], i: number | undefined): string {
  if (i === undefined || i < 0 || i >= row.length) return ''
  return row[i] ?? ''
}

function parseStr(v: string): string | null {
  const s = v.trim()
  return s === '' ? null : s
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

const VALID_STATUSES = new Set(['lead', 'prospect', 'closable', 'sold'])
function parseStatus(v: string): string {
  const s = v.trim().toLowerCase()
  if (VALID_STATUSES.has(s)) return s
  // fuzzy match
  if (s.includes('prospect')) return 'prospect'
  if (s.includes('clos')) return 'closable'
  if (s.includes('sold') || s.includes('customer') || s.includes('active')) return 'sold'
  return 'lead'
}

function parseTags(v: string): string[] {
  return v.split(/[,;|]/).map((t) => t.trim()).filter(Boolean)
}

// ── Row builder ───────────────────────────────────────────────────────────────

export type CustomerImportRow = {
  company_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  phone2: string | null
  phone_ext: string | null
  website: string | null
  street: string | null
  street2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  status: string
  industry: string | null
  lead_source: string | null
  pricing_level: string | null
  terms: string | null
  credit_limit: number | null
  taxable: boolean
  tags: string[]
  notes: string | null
  background_info: string | null
  special_notes: string | null
  ap_contact: string | null
  tax_exempt_code: string | null
  tax_rate: string | null
  vat_number: string | null
}

export function buildRow(headerIndex: Record<string, number>, row: string[]): CustomerImportRow {
  const g = (k: string) => get(row, headerIndex[k])
  return {
    company_name: parseStr(g('company_name')),
    first_name: parseStr(g('first_name')),
    last_name: parseStr(g('last_name')),
    email: parseStr(g('email')),
    phone: parseStr(g('phone')),
    phone2: parseStr(g('phone2')),
    phone_ext: parseStr(g('phone_ext')),
    website: parseStr(g('website')),
    street: parseStr(g('street')),
    street2: parseStr(g('street2')),
    city: parseStr(g('city')),
    state: parseStr(g('state')),
    zip: parseStr(g('zip')),
    country: parseStr(g('country')),
    status: parseStatus(g('status')),
    industry: parseStr(g('industry')),
    lead_source: parseStr(g('lead_source')),
    pricing_level: parseStr(g('pricing_level')),
    terms: parseStr(g('terms')),
    credit_limit: parseNum(g('credit_limit')),
    taxable: parseBool(g('taxable')) ?? true,
    tags: parseTags(g('tags')),
    notes: parseStr(g('notes')),
    background_info: parseStr(g('background_info')),
    special_notes: parseStr(g('special_notes')),
    ap_contact: parseStr(g('ap_contact')),
    tax_exempt_code: parseStr(g('tax_exempt_code')),
    tax_rate: parseStr(g('tax_rate')),
    vat_number: parseStr(g('vat_number')),
  }
}

// ── Column mapping preview ────────────────────────────────────────────────────

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

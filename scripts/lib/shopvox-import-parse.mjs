// Pure parsing helpers for scripts/import-chain-capture.mjs. No I/O, no
// Supabase — kept separate so the mapping logic is testable/inspectable
// without touching a database (used directly by --dry-run).

// "$80.88" | "3,150" | "" | null -> 80.88 | 3150 | null
export function parseMoney(val) {
  if (val == null) return null
  const s = String(val).replace(/[$,]/g, '').trim()
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Generic numeric parse (quantity, priority, etc) — no currency stripping
// beyond commas, since ShopVOX quantities are sometimes "1,000".
export function parseNumber(val) {
  if (val == null) return null
  const s = String(val).replace(/,/g, '').trim()
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function parseIntSafe(val) {
  const n = parseNumber(val)
  return n == null ? null : Math.trunc(n)
}

// "08/11/2026" -> "2026-08-11". Returns null on anything that doesn't match.
export function parseDateMDY(val) {
  if (val == null) return null
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, mo, d, y] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// "07/31" (no year — confirmed live: job right-rail due-date fields render
// without a year) — ASSUMES the given fallback year. Flag every use of this
// at the call site; it is a genuine ambiguity, not a certainty.
export function parseDateMD_assumeYear(val, year) {
  if (val == null) return null
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!m) return parseDateMDY(val) // already has a year — fall through
  const [, mo, d] = m
  return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// "08/11/2026 10:32:03 AM" -> ISO 8601 with no timezone offset applied
// (ShopVOX's displayed timezone was never confirmed against a header/footer
// setting — stored as a naive local timestamp, i.e. the literal wall-clock
// text, not converted to any particular offset). Returns null on mismatch.
export function parseDateTimeMDY(val) {
  if (val == null) return null
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  let [, mo, d, y, h, min, sec, ampm] = m
  h = parseInt(h, 10)
  if (/pm/i.test(ampm) && h !== 12) h += 12
  if (/am/i.test(ampm) && h === 12) h = 0
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${String(h).padStart(2, '0')}:${min}:${sec}`
}

// "QT #13556" -> { kind: 'quote', number: '13556' }, etc. Also handles the
// bare "#13556" style with no prefix.
const PREFIX_KIND = { QT: 'quote', SO: 'sales_order', IN: 'invoice', JB: 'job', PO: 'purchase_order' }
export function parsePrefixedNumber(text) {
  if (!text) return null
  const m = String(text).trim().match(/^(QT|SO|IN|JB|PO)\s*#(\d+)/)
  if (!m) return null
  return { kind: PREFIX_KIND[m[1]], number: m[2] }
}

// "AT\nAnissa Trevino" -> "Anissa Trevino" (strips the leading 2-5 char
// avatar-initials line that precedes every person name in this app's DOM).
export function stripAvatarInitials(val) {
  if (val == null) return null
  const s = String(val)
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  if (lines.length >= 2 && /^[A-Z0-9]{1,5}$/.test(lines[0])) return lines.slice(1).join(' ')
  return lines.join(' ')
}

// Extracts the first UUID found in a string (href, url, id-suffixed route).
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
export function extractUuid(text) {
  if (!text) return null
  const m = String(text).match(UUID_RE)
  return m ? m[0] : null
}

// "-" / "" / null -> null (ShopVOX's own placeholder for "not set" on the
// Show Product Details modal is a bare hyphen).
export function nullIfDash(val) {
  if (val == null) return null
  const s = String(val).trim()
  return s === '' || s === '-' ? null : s
}

// "6 Sqft" -> { amount: 6, uom: 'Sqft' }
export function parseAmountUom(val) {
  if (val == null) return { amount: null, uom: null }
  const s = String(val).trim()
  const m = s.match(/^([\d,.]+)\s*(.*)$/)
  if (!m) return { amount: null, uom: s || null }
  return { amount: parseNumber(m[1]), uom: m[2] || null }
}

// Totals-block value strings, two shapes observed live:
//   "$0.00\nTaxable\n\n($0.00)"   -> amount 0, taxable true, taxAmount 0
//   "$2.36\nTaxable"              -> amount 2.36, taxable true, taxAmount null
//   "false" / "true"              -> boolean-only (pre "Show All Information" shape — not used, we always capture post-expansion)
export function parseChargeValue(val) {
  if (val == null) return { amount: null, taxable: null, taxAmount: null }
  const s = String(val).trim()
  if (s === 'true') return { amount: null, taxable: true, taxAmount: null }
  if (s === 'false') return { amount: null, taxable: false, taxAmount: null }
  const amountM = s.match(/\$([\d,.]+)/)
  const taxAmountM = s.match(/\(\$([\d,.]+)\)/)
  const taxable = /taxable/i.test(s)
  return {
    amount: amountM ? parseMoney(amountM[0]) : null,
    taxable,
    taxAmount: taxAmountM ? parseMoney(taxAmountM[1]) : null,
  }
}

import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrgProfile {
  legal_name: string
  dba_name: string | null
  phone: string | null
  email: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  logo_url: string | null
  tagline: string | null
  footer_note: string | null
  tax_rate?: number | null
}

export type QuotePdfLineItem = {
  sort_order: number
  description: string
  quantity: number
  unit_price: number    // cents
  total_price: number   // cents
  discount_percent: number
  taxable: boolean
  modifier_values?: Record<string, boolean | number> | null
}

export type QuotePdfData = {
  quoteNumber: string          // formatted, e.g. "Q-2026-0001"
  date: string                 // ISO date string
  expiresAt: string | null
  title: string
  terms: string | null         // from term_codes or quote.terms
  notes: string | null
  customer: {
    company_name: string | null
    full_name: string | null   // from primary contact
    street: string | null
    city: string | null
    state: string | null
    zip: string | null
    email: string | null
    phone: string | null
  }
  lineItems: QuotePdfLineItem[]
  discountPercent: number       // quote-level discount %
  modifierLabels: Record<string, string>  // modifier_id / lookup_name → display label
  org: OrgProfile
  depositPercent?: number       // e.g. 60 for 60/40 terms
  depositAmount?: number        // cents: grandTotal * depositPercent / 100
  amountPaid?: number           // cents, for invoices
  balanceDue?: number           // cents, for invoices
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LIME   = '#93ca3b'
const BLACK  = '#1a1a1a'
const GRAY   = '#6b7280'
const LGRAY  = '#e5e7eb'
const WHITE  = '#ffffff'

// Embed system fonts (Helvetica is built into PDFKit / @react-pdf)
Font.registerHyphenationCallback((word) => [word])

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page:      { fontFamily: 'Helvetica', fontSize: 9, color: BLACK, padding: 36, backgroundColor: WHITE },

  // Header
  header:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  logo:      { fontSize: 22, fontFamily: 'Helvetica-Bold', color: LIME },
  orgSub:    { fontSize: 8, color: GRAY, marginTop: 3 },
  qNumBlock: { alignItems: 'flex-end' },
  qNum:      { fontSize: 14, fontFamily: 'Helvetica-Bold', color: BLACK },
  qMeta:     { fontSize: 8, color: GRAY, marginTop: 2 },

  divider:   { borderBottomWidth: 1, borderBottomColor: LGRAY, marginBottom: 14 },

  // Customer block
  section:   { marginBottom: 14 },
  label:     { fontSize: 7, color: GRAY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  value:     { fontSize: 9, color: BLACK },
  boldValue: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: BLACK },

  twoCol:    { flexDirection: 'row', gap: 20, marginBottom: 14 },
  col:       { flex: 1 },

  // Table
  tableHeader: { flexDirection: 'row', backgroundColor: LIME, borderRadius: 2, paddingHorizontal: 6, paddingVertical: 4, marginBottom: 0 },
  tableHCell:  { fontFamily: 'Helvetica-Bold', fontSize: 8, color: WHITE },
  tableRow:    { flexDirection: 'row', paddingHorizontal: 6, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: LGRAY },
  tableCell:   { fontSize: 8.5, color: BLACK },
  tableAlt:    { backgroundColor: '#f9fafb' },
  modLine:     { fontSize: 7.5, color: GRAY, marginTop: 1.5, paddingLeft: 6 },

  // Column widths
  colNum:     { width: 22 },
  colDesc:    { flex: 1 },
  colQty:     { width: 32, textAlign: 'right' },
  colUnit:    { width: 60, textAlign: 'right' },
  colTotal:   { width: 60, textAlign: 'right' },

  // Totals
  totalsBlock: { marginTop: 10, alignItems: 'flex-end' },
  totalRow:    { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 3 },
  totalLabel:  { width: 120, fontSize: 8.5, color: GRAY, textAlign: 'right', paddingRight: 10 },
  totalValue:  { width: 70, fontSize: 8.5, color: BLACK, textAlign: 'right' },
  grandLabel:  { width: 120, fontFamily: 'Helvetica-Bold', fontSize: 10, textAlign: 'right', paddingRight: 10, color: BLACK },
  grandValue:  { width: 70, fontFamily: 'Helvetica-Bold', fontSize: 10, textAlign: 'right', color: BLACK },

  // Deposit / payment rows
  depositRow:   { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#86efac', borderRadius: 3, paddingHorizontal: 8, paddingVertical: 5 },
  depositLabel: { width: 120, fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#15803d', textAlign: 'right', paddingRight: 10 },
  depositValue: { width: 70, fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#15803d', textAlign: 'right' },
  paidLabel:    { width: 120, fontSize: 8.5, color: '#16a34a', textAlign: 'right', paddingRight: 10 },
  paidValue:    { width: 70, fontSize: 8.5, color: '#16a34a', textAlign: 'right' },

  // Terms + footer
  termsBlock:  { marginTop: 16, borderTopWidth: 1, borderTopColor: LGRAY, paddingTop: 10 },
  termsLabel:  { fontSize: 7, fontFamily: 'Helvetica-Bold', color: GRAY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  termsText:   { fontSize: 8, color: GRAY, lineHeight: 1.4 },
  sigLine:     { marginTop: 14, flexDirection: 'row', gap: 30 },
  sigField:    { flex: 1, borderBottomWidth: 1, borderBottomColor: BLACK, paddingBottom: 2, fontSize: 8, color: GRAY },
  footer:      { position: 'absolute', bottom: 20, left: 36, right: 36, borderTopWidth: 1, borderTopColor: LGRAY, paddingTop: 6, textAlign: 'center', fontSize: 7.5, color: GRAY },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function cents(c: number) {
  return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Document ──────────────────────────────────────────────────────────────────

export default function QuoteDocument({
  data,
  documentType = 'QUOTE',
  documentNumber,
}: {
  data: QuotePdfData
  documentType?: string
  documentNumber?: string
}) {
  const { quoteNumber, date, expiresAt, customer, lineItems, discountPercent, terms, notes, modifierLabels, org, depositPercent, depositAmount, amountPaid, balanceDue } = data
  const displayNumber = documentNumber ?? quoteNumber

  const orgName    = org.dba_name ?? org.legal_name
  const orgPhone   = org.phone ?? ''
  const orgAddress = [
    org.street,
    org.city && org.state ? `${org.city}, ${org.state}` : org.city ?? org.state,
    org.zip,
  ].filter(Boolean).join(', ')

  const TAX_RATE = 0.0825

  // Totals
  const subtotalCents = lineItems.reduce((sum, li) => sum + li.total_price, 0)
  const discountCents = discountPercent > 0 ? Math.round(subtotalCents * discountPercent / 100) : 0
  const afterDiscount = subtotalCents - discountCents
  const taxCents = Math.round(
    lineItems
      .filter(li => li.taxable)
      .reduce((sum, li) => sum + li.total_price, 0) *
    (1 - discountPercent / 100) *
    TAX_RATE
  )
  const grandTotal = afterDiscount + taxCents

  const termsText = terms ??
    '60% deposit due upon approval.\n40% balance due on completion.'

  const taxLabel = `Tax (${(TAX_RATE * 100).toFixed(2).replace(/\.?0+$/, '')}%)`

  return (
    <Document title={`${documentType} ${displayNumber}`} author={orgName}>
      <Page size="LETTER" style={s.page}>

        {/* ── HEADER ── */}
        <View style={s.header}>
          <View>
            {org.logo_url
              ? <Image src={org.logo_url} style={{ height: 40, marginBottom: 4, objectFit: 'contain' }} />
              : <Text style={s.logo}>{orgName}</Text>
            }
            {orgAddress ? <Text style={s.orgSub}>{orgAddress}</Text> : null}
            {orgPhone   ? <Text style={s.orgSub}>{orgPhone}</Text>   : null}
          </View>
          <View style={s.qNumBlock}>
            <Text style={[s.qMeta, { fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 1 }]}>{documentType}</Text>
            <Text style={s.qNum}>{displayNumber}</Text>
            <Text style={s.qMeta}>Date: {fmtDate(date)}</Text>
            {expiresAt && <Text style={s.qMeta}>Expires: {fmtDate(expiresAt)}</Text>}
          </View>
        </View>

        <View style={s.divider} />

        {/* ── CUSTOMER BLOCK ── */}
        <View style={s.twoCol}>
          <View style={s.col}>
            <Text style={s.label}>Bill To</Text>
            {customer.company_name && <Text style={s.boldValue}>{customer.company_name}</Text>}
            {customer.full_name && <Text style={s.value}>{customer.full_name}</Text>}
            {customer.street  && <Text style={s.value}>{customer.street}</Text>}
            {(customer.city || customer.state || customer.zip) && (
              <Text style={s.value}>
                {[customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}
              </Text>
            )}
            {customer.email && <Text style={[s.value, { marginTop: 3 }]}>{customer.email}</Text>}
            {customer.phone && <Text style={s.value}>{customer.phone}</Text>}
          </View>
          <View style={s.col}>
            <Text style={s.label}>{documentType} Details</Text>
            <Text style={s.value}>{documentType} #: <Text style={{ fontFamily: 'Helvetica-Bold' }}>{displayNumber}</Text></Text>
            <Text style={s.value}>Date: {fmtDate(date)}</Text>
            {expiresAt && <Text style={s.value}>Valid Until: {fmtDate(expiresAt)}</Text>}
          </View>
        </View>

        {/* ── LINE ITEMS TABLE ── */}
        <View style={s.tableHeader}>
          <Text style={[s.tableHCell, s.colNum]}>#</Text>
          <Text style={[s.tableHCell, s.colDesc]}>Description</Text>
          <Text style={[s.tableHCell, s.colQty]}>Qty</Text>
          <Text style={[s.tableHCell, s.colUnit]}>Unit Price</Text>
          <Text style={[s.tableHCell, s.colTotal]}>Total</Text>
        </View>

        {lineItems.map((li, idx) => {
          const modEntries = li.modifier_values
            ? Object.entries(li.modifier_values).filter(([, v]) => v !== false && v !== 0)
            : []
          return (
            <View key={idx} style={[s.tableRow, idx % 2 === 1 ? s.tableAlt : {}]} wrap={false}>
              <Text style={[s.tableCell, s.colNum]}>{idx + 1}</Text>
              <View style={s.colDesc}>
                <Text style={s.tableCell}>{li.description}</Text>
                {modEntries.map(([key, val]) => (
                  <Text key={key} style={s.modLine}>
                    {modifierLabels[key] ?? key}{typeof val === 'number' ? `: ${val}` : ''}
                  </Text>
                ))}
              </View>
              <Text style={[s.tableCell, s.colQty]}>{li.quantity}</Text>
              <Text style={[s.tableCell, s.colUnit]}>{cents(li.unit_price)}</Text>
              <Text style={[s.tableCell, s.colTotal]}>{cents(li.total_price)}</Text>
            </View>
          )
        })}

        {/* ── TOTALS ── */}
        <View style={s.totalsBlock}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Subtotal</Text>
            <Text style={s.totalValue}>{cents(subtotalCents)}</Text>
          </View>
          {discountCents > 0 && (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Discount ({discountPercent}%)</Text>
              <Text style={s.totalValue}>−{cents(discountCents)}</Text>
            </View>
          )}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>{taxLabel}</Text>
            <Text style={s.totalValue}>{cents(taxCents)}</Text>
          </View>
          <View style={[s.totalRow, { marginTop: 4 }]}>
            <Text style={s.grandLabel}>Grand Total</Text>
            <Text style={s.grandValue}>{cents(grandTotal)}</Text>
          </View>

          {/* Deposit required row (quotes with down-payment terms) */}
          {(depositPercent ?? 0) > 0 && depositAmount !== undefined && (
            <View style={s.depositRow}>
              <Text style={s.depositLabel}>Deposit Required ({depositPercent}%)</Text>
              <Text style={s.depositValue}>{cents(depositAmount)}</Text>
            </View>
          )}

          {/* Amount paid / balance due (invoices) */}
          {amountPaid !== undefined && (
            <>
              <View style={[s.totalRow, { marginTop: 4 }]}>
                <Text style={s.paidLabel}>Amount Paid</Text>
                <Text style={s.paidValue}>({cents(amountPaid)})</Text>
              </View>
              <View style={[s.totalRow, { marginTop: 2 }]}>
                <Text style={s.grandLabel}>Balance Due</Text>
                <Text style={[s.grandValue, { color: (balanceDue ?? 0) === 0 ? '#16a34a' : BLACK }]}>
                  {cents(balanceDue ?? 0)}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* ── NOTES ── */}
        {notes && (
          <View style={{ marginTop: 14 }}>
            <Text style={s.label}>Notes</Text>
            <Text style={s.termsText}>{notes}</Text>
          </View>
        )}

        {/* ── TERMS + SIGNATURE ── */}
        <View style={s.termsBlock}>
          <Text style={s.termsLabel}>Terms &amp; Conditions</Text>
          <Text style={s.termsText}>{termsText}</Text>
          <View style={s.sigLine}>
            <Text style={s.sigField}>Approved By: _________________________</Text>
            <Text style={s.sigField}>Date: ________________</Text>
          </View>
        </View>

        {/* ── FOOTER ── */}
        <Text style={s.footer}>
          {org.footer_note ?? 'Thank you for your business!'}  |  {orgName}  |  {orgPhone}
        </Text>

      </Page>
    </Document>
  )
}

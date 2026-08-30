import { createServiceClient } from '@/lib/supabase/server'

// Resolves the sales tax rate that applies to a given customer.
//
// Replaces the hardcoded `TAX_RATE = 0.0825` constant that used to be
// duplicated in 3 files / 8 call sites (quotes/format.ts, quotes/actions.ts,
// quote-detail-client.tsx x2, lib/pdf/quote-document.tsx) — every quote/SO/
// invoice, for every org and every customer, was taxed at exactly 8.25%
// (Laredo TX) regardless of exemption status or location. Everything this
// resolver reads already existed and was seeded, it just wasn't wired to
// anything: sales_taxes (4 QMI rows, 1STATE flagged is_default) was read
// only by its own settings CRUD page; customers.tax_rate was captured on
// create/import and never read.
//
// Resolution order (locked 2026-08-1X, confirmed against the live
// create-customer-form.tsx before building this):
//   1. Customer is tax-exempt and the exemption hasn't expired -> 0%
//   2. Customer has a specific tax rate set -> use it
//   3. Otherwise -> the org's sales_taxes row where is_default = true
//   4. No default configured -> throw a real error. Deliberately NOT a
//      silent fallback to a constant -- that silent fallback is exactly
//      what created the original bug.
//
// One wrinkle step 2 has to account for: customers.tax_rate is a free-text
// column, not numeric, written by a <select> whose values are
// "8.25" | "8" | "7" | "6" | "exempt" | "" (create-customer-form.tsx:439-445).
// "exempt" is a SECOND, independent way a customer can be marked tax-exempt
// -- distinct from tax_exempt_code/tax_exempt_expires, with no expiry of its
// own. Both are honored below; whichever fires first wins.

export type TaxRateCustomer = {
  tax_rate: string | null
  tax_exempt_code: string | null
  tax_exempt_expires: string | null // date string, e.g. '2027-01-01'
} | null | undefined

export type TaxRateSource = 'customer_exempt' | 'customer_rate' | 'org_default'

export type TaxRateResult = {
  rate: number // fraction, e.g. 0.0825 -- same shape the old TAX_RATE constant was, so every call site's `subtotal * rate` math is unchanged
  source: TaxRateSource
}

export class NoDefaultTaxRateError extends Error {
  constructor(organizationId: string) {
    super(
      `No default sales tax is configured for this organization (${organizationId}). ` +
      `Set one in Settings > Accounting > Sales Taxes before generating quotes, sales orders, or invoices.`
    )
    this.name = 'NoDefaultTaxRateError'
  }
}

function isExemptionActive(expires: string | null): boolean {
  if (!expires) return true
  // tax_exempt_expires is a date (no time component) -- treat the whole
  // expiry day as still valid, matching normal "exempt through this date"
  // certificate semantics.
  return new Date(`${expires}T23:59:59Z`).getTime() >= Date.now()
}

// Pure resolution logic -- no DB access. Takes whatever the caller already
// has loaded (a customer row's 3 relevant columns, and the org's default
// sales_taxes.rate as a PERCENT e.g. 8.25, or null if none configured).
export function resolveTaxRate(
  customer: TaxRateCustomer,
  orgDefaultRatePercent: number | null,
  organizationId: string,
): TaxRateResult {
  if (customer?.tax_exempt_code && isExemptionActive(customer.tax_exempt_expires)) {
    return { rate: 0, source: 'customer_exempt' }
  }

  const rawRate = customer?.tax_rate?.trim()
  if (rawRate) {
    if (rawRate.toLowerCase() === 'exempt') {
      return { rate: 0, source: 'customer_exempt' }
    }
    const parsed = Number(rawRate)
    if (Number.isFinite(parsed)) {
      return { rate: parsed / 100, source: 'customer_rate' }
    }
    // Malformed value (shouldn't happen via the <select>, but this is a
    // free-text DB column reachable by import/direct edit) -- fall through
    // to the org default rather than crash on bad legacy data.
  }

  if (orgDefaultRatePercent != null) {
    return { rate: orgDefaultRatePercent / 100, source: 'org_default' }
  }

  throw new NoDefaultTaxRateError(organizationId)
}

// DB-fetching convenience wrapper for server code that has a service-role
// client and an organizationId but hasn't loaded the customer or the org's
// default sales_taxes row yet.
export async function resolveTaxRateForCustomer(
  service: ReturnType<typeof createServiceClient>,
  organizationId: string,
  customerId: string | null,
): Promise<TaxRateResult> {
  let customer: TaxRateCustomer = null
  if (customerId) {
    const { data } = await service
      .from('customers')
      .select('tax_rate, tax_exempt_code, tax_exempt_expires')
      .eq('id', customerId)
      .maybeSingle()
    customer = data
  }

  const { data: defaultTax } = await service
    .from('sales_taxes')
    .select('rate')
    .eq('organization_id', organizationId)
    .eq('is_default', true)
    .maybeSingle()

  return resolveTaxRate(customer, defaultTax ? Number(defaultTax.rate) : null, organizationId)
}

// Pure rate-selection logic for the Shipping module: given a customer's
// preferred shipping method (a shipping_methods.name string, or null/
// unset) and a list of rates already fetched from EasyPost, decides
// which rate to use and whether the choice is expensive enough to flag
// for a sales rep to confirm with the customer first.
//
// No DB access, no network calls — takes plain data in, returns plain
// data out, so it can be tested directly and reused from any UI later.

export type RateOption = {
  id: string
  carrier: string   // EasyPost's raw carrier string, e.g. "FedEx", "UPS", "USPS"
  service: string   // EasyPost's raw service string, e.g. "FEDEX_GROUND", "Priority"
  rate: string       // dollars, as a string, e.g. "12.50" — matches EasypostRate shape
  delivery_days: number | null
  delivery_date: string | null
}

export type RateSelectionResult = {
  selectedRate: RateOption | null
  cheapestRate: RateOption | null
  matchedPreference: boolean   // true if the customer's preferred method was actually found among the rates
  isFlagged: boolean           // true if the selected rate is >= FLAG_THRESHOLD above the cheapest
  flagMessage: string | null
}

// How much more expensive the selected rate has to be than the
// cheapest available rate before we flag it for confirmation.
export const FLAG_THRESHOLD = 0.20 // 20%

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Best-effort carrier detection from either a shipping_methods.name
// string (e.g. "FedEx Ground") or an EasyPost rate.carrier string
// (e.g. "FedEx"). Returns null if no known carrier is recognized —
// this is the expected/correct outcome for non-carrier methods like
// "Best Available Price", "Customer Pickup", "Delivered by Quarter
// Mile Employee", or "Freight", none of which EasyPost quotes as a
// quotable multi-carrier rate, so they naturally fall through to the
// cheapest-rate fallback below.
function detectCarrierToken(name: string): string | null {
  const n = normalizeToken(name)
  if (n.includes('fedex')) return 'fedex'
  if (n.includes('ups')) return 'ups'
  if (n.includes('usps')) return 'usps'
  if (n.includes('dhl')) return 'dhl'
  if (n.includes('canadapost')) return 'canadapost'
  return null
}

type ServiceCategory = 'overnight' | '2day' | 'ground' | 'priority' | 'firstclass' | 'express'

function detectServiceCategories(name: string): ServiceCategory[] {
  const n = normalizeToken(name)
  const cats: ServiceCategory[] = []
  if (/overnight|nextday/.test(n)) cats.push('overnight')
  if (/2day|2nd|secondday/.test(n)) cats.push('2day')
  if (/ground/.test(n)) cats.push('ground')
  if (/priority/.test(n)) cats.push('priority')
  if (/first/.test(n)) cats.push('firstclass')
  if (/express/.test(n)) cats.push('express')
  return cats
}

function serviceMatchesCategory(service: string, category: ServiceCategory): boolean {
  const s = normalizeToken(service)
  switch (category) {
    case 'overnight':  return s.includes('overnight') || s.includes('nextday') || s.includes('1day')
    case '2day':       return (s.includes('2') && s.includes('day')) || s.includes('secondday')
    case 'ground':     return s.includes('ground')
    case 'priority':   return s.includes('priority')
    case 'firstclass': return s.includes('first')
    case 'express':    return s.includes('express')
  }
}

function cheapestOf(rates: RateOption[]): RateOption {
  return rates.reduce((cheapest, r) => (parseFloat(r.rate) < parseFloat(cheapest.rate) ? r : cheapest))
}

// Finds the rate among `rates` that best matches a customer's
// preferred shipping method name. Carrier match is required; service
// match (Ground/2Day/Overnight/etc.) narrows it further when possible,
// otherwise the cheapest rate for the matched carrier is used. Returns
// null if the preference doesn't map to any carrier present in the
// results (including non-carrier methods like "Customer Pickup").
function findPreferredRate(preferredMethodName: string, rates: RateOption[]): RateOption | null {
  const carrierToken = detectCarrierToken(preferredMethodName)
  if (!carrierToken) return null

  const carrierRates = rates.filter((r) => detectCarrierToken(r.carrier) === carrierToken)
  if (carrierRates.length === 0) return null

  const categories = detectServiceCategories(preferredMethodName)
  if (categories.length > 0) {
    const serviceMatches = carrierRates.filter((r) => categories.some((c) => serviceMatchesCategory(r.service, c)))
    if (serviceMatches.length > 0) return cheapestOf(serviceMatches)
  }

  return cheapestOf(carrierRates)
}

export function selectShippingRate(
  preferredMethodName: string | null | undefined,
  rates: RateOption[],
): RateSelectionResult {
  if (!rates || rates.length === 0) {
    return { selectedRate: null, cheapestRate: null, matchedPreference: false, isFlagged: false, flagMessage: null }
  }

  const cheapestRate = cheapestOf(rates)
  const preferredRate = preferredMethodName ? findPreferredRate(preferredMethodName, rates) : null

  const selectedRate = preferredRate ?? cheapestRate
  const matchedPreference = preferredRate !== null

  const cheapestPrice = parseFloat(cheapestRate.rate)
  const selectedPrice = parseFloat(selectedRate.rate)
  const pctAboveCheapest = cheapestPrice > 0 ? (selectedPrice - cheapestPrice) / cheapestPrice : 0

  const isFlagged = matchedPreference && selectedRate.id !== cheapestRate.id && pctAboveCheapest >= FLAG_THRESHOLD

  let flagMessage: string | null = null
  if (isFlagged) {
    const diff = (selectedPrice - cheapestPrice).toFixed(2)
    flagMessage =
      `Customer's preferred ${selectedRate.carrier} ${selectedRate.service} is $${diff} more than the ` +
      `best available rate (${cheapestRate.carrier} ${cheapestRate.service}) — confirm with customer before shipping this way.`
  }

  return { selectedRate, cheapestRate, matchedPreference, isFlagged, flagMessage }
}

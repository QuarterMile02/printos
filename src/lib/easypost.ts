import EasyPostClient from '@easypost/api'
import { createServiceClient } from '@/lib/supabase/server'

const QMI_ADDRESS = {
  name: 'Quarter Mile Inc',
  street1: '6420 Polaris Dr Ste 4',
  city: 'Laredo',
  state: 'TX',
  zip: '78041',
  country: 'US',
}

// FedEx's PHONENUMBER.EMPTY validation checks BOTH addresses on the
// shipment, not just the destination -- confirmed live: buying a FedEx
// label failed with the same error even after the destination address had
// a phone, and only succeeded once QMI_ADDRESS (from_address, used
// unconditionally for every shipment) also had one. The org's real
// business phone lives in org_profile (Settings -> Billing), same place
// invoices/quotes pull their sender info from.
async function resolveFromAddress(orgId?: string): Promise<typeof QMI_ADDRESS & { phone?: string }> {
  if (orgId) {
    const service = createServiceClient()
    const { data } = await service
      .from('org_profile')
      .select('phone')
      .eq('organization_id', orgId)
      .maybeSingle()
    const phone = (data as { phone: string | null } | null)?.phone
    if (phone) return { ...QMI_ADDRESS, phone }
  }
  return QMI_ADDRESS
}

type EasypostCredentials = { api_key?: string; test_api_key?: string }

// Resolves the EasyPost API key to use for a request. Checks the org's
// connected carrier_connections row first (Settings -> Shipping ->
// Carriers); falls back to the legacy global env vars ONLY when no
// connected row exists for that org, so orgs that haven't gone through
// the Connect flow yet (or when orgId is unknown) keep working.
async function resolveApiKey(orgId?: string): Promise<{ apiKey: string; testMode: boolean }> {
  if (orgId) {
    const service = createServiceClient()
    const { data } = await service
      .from('carrier_connections')
      .select('credentials, use_test_mode, is_connected')
      .eq('organization_id', orgId)
      .eq('carrier', 'easypost')
      .maybeSingle()
    const row = data as { credentials: EasypostCredentials; use_test_mode: boolean; is_connected: boolean } | null
    if (row?.is_connected) {
      const key = row.use_test_mode ? row.credentials?.test_api_key : row.credentials?.api_key
      if (key) return { apiKey: key, testMode: row.use_test_mode }
    }
  }

  const envTestMode = process.env.EASYPOST_TEST_API_KEY != null && !process.env.EASYPOST_API_KEY
  const key = envTestMode ? process.env.EASYPOST_TEST_API_KEY : process.env.EASYPOST_API_KEY
  if (!key) throw new Error('EasyPost API key not configured. Connect EasyPost under Settings → Shipping → Carriers, or set EASYPOST_API_KEY (or EASYPOST_TEST_API_KEY for test mode).')
  return { apiKey: key, testMode: envTestMode }
}

async function getClient(orgId?: string): Promise<InstanceType<typeof EasyPostClient>> {
  const { apiKey } = await resolveApiKey(orgId)
  return new EasyPostClient(apiKey)
}

export type EasypostAddress = {
  name?: string
  street1: string
  city: string
  state: string
  zip: string
  country?: string
  // FedEx specifically rejects rate/label requests with no phone on the
  // destination address (PHONENUMBER.EMPTY) -- USPS and others don't need
  // it, but EasyPost accepts it universally, so it's always passed through
  // when present rather than only wiring it up for FedEx.
  phone?: string
}

export type EasypostParcel = {
  length: number   // inches
  width: number    // inches
  height: number   // inches
  weight: number   // ounces
}

export type EasypostRate = {
  id: string
  carrier: string
  service: string
  rate: string         // string e.g. "12.50"
  delivery_days: number | null
  delivery_date: string | null
}

export type RatesResult = {
  shipmentId: string
  rates: EasypostRate[]
}

export async function getRates(
  toAddress: EasypostAddress,
  parcel: EasypostParcel,
  orgId?: string,
): Promise<RatesResult> {
  const client = await getClient(orgId)
  const fromAddress = await resolveFromAddress(orgId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shipment = await (client.Shipment as any).create({
    to_address: { country: 'US', ...toAddress },
    from_address: fromAddress,
    parcel,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rates: EasypostRate[] = ((shipment.rates ?? []) as any[])
    .map((r) => ({
      id: r.id as string,
      carrier: r.carrier as string,
      service: r.service as string,
      rate: r.rate as string,
      delivery_days: (r.delivery_days ?? null) as number | null,
      delivery_date: (r.delivery_date ?? null) as string | null,
    }))
    .sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate))
  return { shipmentId: shipment.id as string, rates }
}

export type BuyLabelResult = {
  trackingCode: string
  labelUrl: string
  carrier: string
  service: string
  actualCost: number  // dollars (float)
}

export async function buyLabel(
  shipmentId: string,
  rateId: string,
  orgId?: string,
): Promise<BuyLabelResult> {
  const client = await getClient(orgId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shipment = await (client.Shipment as any).buy(shipmentId, rateId)
  return {
    trackingCode: (shipment.tracking_code ?? '') as string,
    labelUrl: (shipment.postage_label?.label_url ?? '') as string,
    carrier: (shipment.selected_rate?.carrier ?? '') as string,
    service: (shipment.selected_rate?.service ?? '') as string,
    actualCost: parseFloat(shipment.selected_rate?.rate ?? '0'),
  }
}

export async function createWebhook(url: string, orgId?: string): Promise<string> {
  const client = await getClient(orgId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webhook = await (client.Webhook as any).create({ url })
  return webhook.id as string
}

import EasyPostClient from '@easypost/api'

const QMI_ADDRESS = {
  name: 'Quarter Mile Inc',
  street1: '6420 Polaris Dr Ste 4',
  city: 'Laredo',
  state: 'TX',
  zip: '78041',
  country: 'US',
}

function getClient(testMode = false): InstanceType<typeof EasyPostClient> {
  const key = testMode
    ? process.env.EASYPOST_TEST_API_KEY
    : process.env.EASYPOST_API_KEY
  if (!key) throw new Error('EasyPost API key not configured. Set EASYPOST_API_KEY (or EASYPOST_TEST_API_KEY for test mode).')
  return new EasyPostClient(key)
}

export type EasypostAddress = {
  name?: string
  street1: string
  city: string
  state: string
  zip: string
  country?: string
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
  testMode = false,
): Promise<RatesResult> {
  const client = getClient(testMode)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shipment = await (client.Shipment as any).create({
    to_address: { country: 'US', ...toAddress },
    from_address: QMI_ADDRESS,
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
  testMode = false,
): Promise<BuyLabelResult> {
  const client = getClient(testMode)
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

export async function createWebhook(url: string, testMode = false): Promise<string> {
  const client = getClient(testMode)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webhook = await (client.Webhook as any).create({ url })
  return webhook.id as string
}

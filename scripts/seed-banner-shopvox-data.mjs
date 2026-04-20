// Seed shopvox_data for the "Banner Regular Single Sided" product.
// Idempotent — re-running overwrites the shopvox_data column + sets
// migration_status='shopvox_reference'.
//
// Usage:  node scripts/seed-banner-shopvox-data.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const envText = readFileSync(resolve(repoRoot, '.env.local'), 'utf8')
const env = {}
for (const rawLine of envText.split(/\r?\n/)) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq === -1) continue
  const key = line.slice(0, eq).trim()
  let val = line.slice(eq + 1).trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  env[key] = val
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const ORG_ID = '4ca12dff-97be-4472-8099-ab102a3af01a'
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const shopvoxData = {
  basic: {
    name: 'Banner Regular- Single Sided up to 5ft',
    display_name: 'Full Color Single Sided Banner',
    type: 'Signs / Large Format Printing',
    workflow: 'Digital Print w/ Assembly',
    category: 'Banner- Regular / Mesh / Anti-curl / Block-out',
    secondary_category: 'Rigid Signs- Direct Printing',
  },
  pricing: {
    pricing_type: 'Formula',
    formula: 'Area',
    pricing_method: 'Standard',
    buying_units: 'Each',
    range_discount: 'Rigid Direct Coroplast',
    apply_discounts: true,
    apply_range_discount_for_qty: true,
  },
  modifiers: [
    { name: 'Height',                  type: 'Numeric', default: 0 },
    { name: 'Width',                   type: 'Numeric', default: 0 },
    { name: 'Grommets_Spacing',        type: 'Numeric', default: 0 },
    { name: 'Assembly_Table',          type: 'Numeric', default: 0 },
    { name: 'Accessory_Qty',           type: 'Numeric', default: 0 },
    { name: 'Accesssory2_Qty',         type: 'Numeric', default: 0 },
    { name: 'WindSlits',               type: 'Boolean', default: false },
    { name: 'No_Grommets',             type: 'Boolean', default: false },
    { name: 'Grommets_Corners',        type: 'Boolean', default: false },
    { name: 'Hemtek_30mmHem',          type: 'Boolean', default: false },
    { name: 'Banner_Hem_All_Sides',    type: 'Boolean', default: false },
    { name: 'Banner_Hem_Sides',        type: 'Boolean', default: false },
    { name: 'Hemtek_40mmHem',          type: 'Boolean', default: false },
    { name: 'Banner_Hem_Top_Bottom',   type: 'Boolean', default: false },
    { name: 'Pole_Pocket_1in',         type: 'Boolean', default: false },
    { name: 'Pole_Pocket_2in',         type: 'Boolean', default: false },
    { name: 'Pole_Pocket_1_5in',       type: 'Boolean', default: false },
  ],
  dropdown_menus: [
    { name: 'Banner Roll Size:',     kind: 'Material',    category: 'Roll Materials',   optional: false },
    { name: 'Printer',               kind: 'MachineRate', category: null,               optional: false },
    { name: 'Hemming (Optional)',    kind: 'MachineRate', category: null,               optional: true  },
    { name: 'Pole Pocket (Optional)',kind: 'MachineRate', category: null,               optional: true  },
    { name: 'Accessory (Optional)',  kind: 'Material',    category: 'Accessories',      optional: true  },
    { name: 'Accessory #2 (Optional)', kind: 'Material',  category: 'Accessories',      optional: true  },
  ],
  default_items: [
    { idx: 1,  name: 'Prepress - per minute',                   kind: 'LaborRate',   formula: 'Unit',      multiplier: 10, per_li: false, modifier: null, note: '10 minutes of prepress setup, flat per job' },
    { idx: 2,  name: 'Zund Prep - per minute',                  kind: 'LaborRate',   formula: 'Unit',      multiplier: 10, per_li: false, modifier: null, note: '10 minutes of Zund prep, flat per job' },
    { idx: 3,  name: 'Printing Labor',                          kind: 'LaborRate',   formula: 'Area',      multiplier: 1,  per_li: true,  modifier: null, note: 'Charges per sq ft × quantity' },
    { idx: 4,  name: 'Ink Epson GS3 Printing',                  kind: 'Material',    formula: 'Area',      multiplier: 1,  per_li: true,  modifier: null, note: 'Ink cost per sq ft × quantity' },
    { idx: 5,  name: 'Hemtek Prep - per minute',                kind: 'LaborRate',   formula: 'Unit',      multiplier: 10, per_li: false, modifier: { kind: 'formula', expression: '((Banner_Hem_All_Sides)+(Banner_Hem_Sides)+(Banner_Hem_Top_Bottom))' }, note: 'Charges 10 min × number of hemming options selected' },
    { idx: 6,  name: 'Hemming Labor',                           kind: 'LaborRate',   formula: 'Perimeter', multiplier: 1,  per_li: true,  modifier: { kind: 'checkbox', expression: 'Banner_Hem_All_Sides' }, note: 'Charges by perimeter only when Hem All Sides checked' },
    { idx: 7,  name: 'Hemming Labor',                           kind: 'LaborRate',   formula: 'Height',    multiplier: 1,  per_li: true,  modifier: { kind: 'checkbox', expression: 'Banner_Hem_Sides' }, note: 'Charges by height only when Hem Sides checked' },
    { idx: 8,  name: 'Hemming Labor',                           kind: 'LaborRate',   formula: 'Width',     multiplier: 1,  per_li: true,  modifier: { kind: 'checkbox', expression: 'Banner_Hem_Top_Bottom' }, note: 'Charges by width only when Hem Top Bottom checked' },
    { idx: 9,  name: 'Pole Pocket Labor',                       kind: 'LaborRate',   formula: 'Width',     multiplier: 1,  per_li: true,  modifier: { kind: 'formula', expression: '((Pole_Pocket_1in)+(Pole_Pocket_2in)+(Pole_Pocket_1_5in))' }, note: 'Charges by width × whichever pole pocket selected' },
    { idx: 10, name: 'Grommets 3/8in Diameter, No.2 Nickel',    kind: 'Material',    formula: 'Unit',      multiplier: 1,  per_li: true,  modifier: { kind: 'numeric', expression: 'Grommets_Spacing' }, note: 'Charges per grommet based on spacing' },
    { idx: 11, name: 'Hemtek Pole Pocket Prep - per minute',    kind: 'LaborRate',   formula: 'Unit',      multiplier: 10, per_li: false, modifier: { kind: 'formula', expression: '((Pole_Pocket_1in)+(Pole_Pocket_2in)+(Pole_Pocket_1_5in))' }, note: '10 min prep only when a pole pocket option selected' },
    { idx: 12, name: 'Assembly',                                kind: 'LaborRate',   formula: 'Unit',      multiplier: 1,  per_li: false, modifier: { kind: 'numeric', expression: 'Assembly_Table' }, note: 'Charges assembly time entered' },
    { idx: 13, name: 'Zund Cutting Labor- Banner UCT',          kind: 'LaborRate',   formula: 'Area',      multiplier: 1,  per_li: true,  modifier: null, note: 'Cutting labor per sq ft × quantity' },
    { idx: 14, name: 'Zund Cutting UCT- Thru Cut Banner',       kind: 'MachineRate', formula: 'Area',      multiplier: 1,  per_li: true,  modifier: { kind: 'checkbox', expression: 'WindSlits' }, note: 'Machine cost only when WindSlits checked' },
    { idx: 15, name: 'Zund Cutting UCT- Thru Cut Banner',       kind: 'MachineRate', formula: 'Area',      multiplier: 1,  per_li: true,  modifier: null, note: 'Standard Zund machine cost always charges' },
    { idx: 16, name: 'Zund Cutting Labor- Banner UCT',          kind: 'LaborRate',   formula: 'Area',      multiplier: 1,  per_li: true,  modifier: { kind: 'checkbox', expression: 'WindSlits' }, note: 'Extra cutting labor only when WindSlits checked' },
  ],
}

async function main() {
  const candidates = [
    'Banner Regular- Single Sided up to 5ft',
    'Banner Regular Single Sided',
  ]

  let product = null
  for (const name of candidates) {
    const { data } = await sb
      .from('products')
      .select('id, name')
      .eq('organization_id', ORG_ID)
      .eq('name', name)
      .maybeSingle()
    if (data?.id) { product = data; break }
  }

  if (!product) {
    const { data } = await sb
      .from('products')
      .select('id, name')
      .eq('organization_id', ORG_ID)
      .ilike('name', '%banner%single%sided%')
      .limit(1)
      .maybeSingle()
    product = data
  }

  if (!product) {
    console.error('No Banner product found. Run `node scripts/seed-products.mjs` first.')
    process.exit(1)
  }

  const { error } = await sb
    .from('products')
    .update({
      shopvox_data: shopvoxData,
      migration_status: 'shopvox_reference',
    })
    .eq('id', product.id)

  if (error) {
    console.error(`Update failed: ${error.message}`)
    process.exit(1)
  }

  console.log(`✓ shopvox_data written to: ${product.name} (${product.id})`)
}

main().catch((err) => { console.error(err); process.exit(1) })

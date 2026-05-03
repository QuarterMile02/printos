import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// Load env
const env = readFileSync('.env.local', 'utf8')
const vars = Object.fromEntries(env.split('\n').filter(l => l.includes('=')).map(l => l.split('=').map(s => s.trim())))
const sb = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY)

const { data: wrap } = await sb.from('materials').select('id,name').ilike('name', '%Vinyl Wrap%Avery SW900 60in%').limit(3)
const { data: stake } = await sb.from('materials').select('id,name').ilike('name', '%Stake H Wire%10in%24in%').limit(3)
console.log('Wrap vinyl found:', wrap)
console.log('H-Wire found:', stake)

const { data: wrapProd } = await sb.from('products').select('id').ilike('name','%Vehicle Wrap Full Color%').limit(1)
const { data: stakeProd } = await sb.from('products').select('id').ilike('name','%H-Wire Stake 10x24%').limit(1)
console.log('Vehicle Wrap product:', wrapProd)
console.log('H-Wire product:', stakeProd)

if (wrap?.[0] && wrapProd?.[0]) {
  const { error } = await sb.from('product_default_items').insert({
    product_id: wrapProd[0].id, item_type: 'Material', material_id: wrap[0].id,
    system_formula: 'Area', charge_per_li_unit: true, multiplier: 1, sort_order: 0, include_in_base_price: true
  })
  console.log('Wrap vinyl insert:', error ? error.message : 'OK')
}

if (stake?.[0] && stakeProd?.[0]) {
  const { error } = await sb.from('product_default_items').insert({
    product_id: stakeProd[0].id, item_type: 'Material', material_id: stake[0].id,
    system_formula: 'Unit', charge_per_li_unit: true, multiplier: 1, sort_order: 0, include_in_base_price: true
  })
  console.log('H-Wire insert:', error ? error.message : 'OK')
}
/**
 * fuzzy-match-notfound.ts
 *
 * For each PrintOS product that the original import couldn't match to an SVX
 * JSON entry, tries to find a match by normalizing names (stripping suffix
 * variants like "(Panels)", "(PANELS)", etc.).
 *
 * Read-only — no DB writes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const JSON_PATH        = process.argv[2] || './svx_products_FINAL_666.json';

if (!SUPABASE_URL || !SUPABASE_SERVICE) {
  console.error('❌ Missing SUPABASE env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// Suffixes to strip before comparing
const STRIP_SUFFIXES = [
  ' (Panels)', ' (PANELS)', ' (panels)',
  '- Panels',  '- PANELS',  '- panels',
  '(Panels)',  '(PANELS)',  '(panels)',
];

function stripSuffixes(s: string): string {
  let out = s.trim();
  for (const suffix of STRIP_SUFFIXES) {
    if (out.endsWith(suffix)) {
      out = out.slice(0, out.length - suffix.length).trim();
      break;
    }
  }
  return out;
}

function normalize(s: string): string {
  return stripSuffixes(s).toLowerCase();
}

async function main() {
  // Load the SVX JSON (source of truth — 666 products)
  const svxData: Record<string, any> = JSON.parse(
    fs.readFileSync(path.resolve(JSON_PATH), 'utf8')
  );
  console.log(`Loaded ${Object.keys(svxData).length} SVX products from JSON`);

  // Build SVX lookup: normalized name → original SVX key
  const svxByNorm = new Map<string, string>();
  for (const key of Object.keys(svxData)) {
    svxByNorm.set(normalize(key), key);
  }

  // Fetch the 192 not-found PrintOS products (those with shopvox_data but no SVX match)
  // We re-derive this from the full product list rather than the stale .json file
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, shopvox_data')
    .not('shopvox_data', 'is', null)
    .order('name');

  if (error) { console.error('❌ Supabase:', error); process.exit(1); }
  console.log(`Fetched ${products.length} PrintOS products with shopvox_data\n`);

  // Replicate original matching logic to find unmatched products
  const SKIP_NAMES = new Set(['Retractable Print Only with Assembly']);
  const svxByName    = new Map(Object.entries(svxData));
  const svxByNameLower = new Map(Object.keys(svxData).map(k => [k.toLowerCase().trim(), k]));

  const unmatched: typeof products = [];

  for (const product of products) {
    if (SKIP_NAMES.has(product.name)) continue;

    const svxBasicName = product.shopvox_data?.basic?.name;
    let found = false;

    if (svxBasicName) {
      found = svxByName.has(svxBasicName) ||
              svxByNameLower.has(svxBasicName.toLowerCase().trim());
    }
    if (!found) {
      found = svxByName.has(product.name) ||
              svxByNameLower.has(product.name.toLowerCase().trim());
    }

    if (!found) unmatched.push(product);
  }

  console.log(`Unmatched PrintOS products (confirmed): ${unmatched.length}\n`);
  console.log('='.repeat(70));
  console.log('FUZZY MATCH RESULTS');
  console.log('='.repeat(70));

  const fuzzyMatches: Array<{
    printosId: string;
    printosName: string;
    svxKey: string;
    svxProduct: any;
    reason: string;
  }> = [];
  const stillUnmatched: string[] = [];

  for (const product of unmatched) {
    const printosName    = product.name;
    const svxBasicName   = product.shopvox_data?.basic?.name as string | undefined;

    // Try normalized printosName against SVX keys
    const normPrintos = normalize(printosName);
    const strippedPrintos = stripSuffixes(printosName);
    const wasStripped = strippedPrintos.toLowerCase() !== printosName.toLowerCase().trim();

    let svxKey: string | undefined;
    let reason = '';

    // 1. Exact SVX key match after normalization (both sides stripped)
    svxKey = svxByNorm.get(normPrintos);
    if (svxKey) {
      reason = wasStripped
        ? `suffix-strip: "${printosName}" → stripped to "${strippedPrintos}"`
        : 'exact-norm (whitespace/case)';
    }

    // 2. Try basic.name normalized
    if (!svxKey && svxBasicName) {
      const normBasic = normalize(svxBasicName);
      svxKey = svxByNorm.get(normBasic);
      if (svxKey) {
        const basicStripped = stripSuffixes(svxBasicName).toLowerCase() !== svxBasicName.toLowerCase().trim();
        reason = basicStripped
          ? `basic.name suffix-strip: "${svxBasicName}" → stripped`
          : 'basic.name exact-norm';
      }
    }

    if (svxKey) {
      fuzzyMatches.push({
        printosId:   product.id,
        printosName,
        svxKey,
        svxProduct:  svxData[svxKey],
        reason,
      });
    } else {
      stillUnmatched.push(printosName);
    }
  }

  // ── Print results ──────────────────────────────────────────────
  const suffixStripped = fuzzyMatches.filter(m => m.reason.includes('suffix-strip'));
  const otherMatches   = fuzzyMatches.filter(m => !m.reason.includes('suffix-strip'));

  if (suffixStripped.length) {
    console.log(`\n── Suffix-stripped matches (${suffixStripped.length}) ──`);
    for (const m of suffixStripped) {
      const svx = m.svxProduct;
      console.log(`  PrintOS: "${m.printosName}"`);
      console.log(`  SVX key: "${m.svxKey}"  (Mod:${svx.modifiers?.length ?? 0} DD:${svx.dropdownMenus?.length ?? 0} DI:${svx.defaultItems?.length ?? 0})`);
      console.log(`  Reason:  ${m.reason}`);
      console.log();
    }
  }

  if (otherMatches.length) {
    console.log(`\n── Other fuzzy matches (${otherMatches.length}) ──`);
    for (const m of otherMatches) {
      const svx = m.svxProduct;
      console.log(`  PrintOS: "${m.printosName}"`);
      console.log(`  SVX key: "${m.svxKey}"  (Mod:${svx.modifiers?.length ?? 0} DD:${svx.dropdownMenus?.length ?? 0} DI:${svx.defaultItems?.length ?? 0})`);
      console.log(`  Reason:  ${m.reason}`);
      console.log();
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`STILL UNMATCHED: ${stillUnmatched.length}`);
  console.log('='.repeat(70));
  for (const n of stillUnmatched) console.log(`  - ${n}`);

  // Save
  fs.writeFileSync('./svx_fuzzy_matches.json', JSON.stringify(fuzzyMatches.map(m => ({
    printosId: m.printosId,
    printosName: m.printosName,
    svxKey: m.svxKey,
    reason: m.reason,
  })), null, 2));

  console.log(`\n── Summary ──`);
  console.log(`  Fuzzy matches found: ${fuzzyMatches.length}`);
  console.log(`    suffix-strip:      ${suffixStripped.length}`);
  console.log(`    other:             ${otherMatches.length}`);
  console.log(`  Still unmatched:     ${stillUnmatched.length}`);
  console.log(`\nSaved: svx_fuzzy_matches.json`);
}

main().catch(console.error);

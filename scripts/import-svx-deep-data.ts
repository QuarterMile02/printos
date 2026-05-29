/**
 * import-svx-deep-data.ts
 * 
 * Merges ShopVOX deep recipe data (modifiers, dropdowns, default items)
 * from svx_products_FINAL_666.json into PrintOS products.shopvox_data
 * 
 * Matching strategy:
 *   1. Primary:   products.shopvox_data->'basic'->>'name'  matches JSON key (in_progress products)
 *   2. Fallback:  products.name matches JSON key (shopvox_reference products)
 *   3. Skip:      "Retractable Print Only with Assembly" (duplicate name - manual review needed)
 *   4. Skip:      products with null shopvox_data
 * 
 * After matching:
 *   - Stores ShopVOX UUID into shopvox_data.svx_uuid
 *   - Merges modifiers with optional flag + defaultValue
 *   - Merges dropdownMenus with selectedItems
 *   - Merges defaultItems with formula, multiplier, attachNumModifier, attachChkModifier
 *   - Never overwrites basic/pricing/existing fields - only enriches
 * 
 * Run: npx ts-node scripts/import-svx-deep-data.ts [path-to-json]
 * Example: npx ts-node scripts/import-svx-deep-data.ts ./svx_products_FINAL_666.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────
const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SKIP_NAMES       = new Set(['Retractable Print Only with Assembly']); // duplicates
const DRY_RUN          = process.argv.includes('--dry-run');
const JSON_PATH        = process.argv[2] || './svx_products_FINAL_666.json';

if (!SUPABASE_URL || !SUPABASE_SERVICE) {
  console.error('❌ Missing SUPABASE env vars. Make sure .env.local is loaded.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// ── Types ─────────────────────────────────────────────────────
interface SvxModifier {
  Name: string;
  Type: string;
  'In Use': string;
  'Default Value'?: string;
  optional: boolean | undefined;
  defaultValue: string | number | undefined;
  _modalRaw?: string;
}

interface SvxDropdown {
  'Menu Name': string;
  Item: string;
  'Item Type': string;
  Reference: string;
  selectedItems: string[];
  totalSelected: number;
  hasFilter: boolean;
  // Playwright modal fields (snake_case, optional — only present after deep scrape)
  formula?: string | null;
  multiplier?: string | null;
  fixed_quantity?: string | null;
  percentage_of_base?: string | null;
  charge_per_li_unit?: boolean | null;
  include_in_base_price?: boolean | null;
  optional?: boolean | null;
  use_item_per_li_unit?: boolean | null;
  numeric_modifier?: string | null;
  checkbox_modifier?: string | null;
  item_category?: string | null;
  item_kind?: string | null;
  reference?: string | null;
}

interface SvxDefaultItem {
  Name: string;
  'Item Type': string;
  formula: string | null;
  multiplier: number | null;
  attachNumModifier: string | null;
  attachChkModifier: string | null;
  _modalRaw?: string;
}

interface SvxProduct {
  uuid: string;
  name: string;
  scrapedAt: string;
  modifiers: SvxModifier[];
  dropdownMenus: SvxDropdown[];
  defaultItems: SvxDefaultItem[];
  noTemplate?: boolean;
  emptyTemplate?: boolean;
  summary: {
    modifiers: number;
    dropdowns: number;
    defaultItems: number;
    errors: string[];
  };
}

// ── Merge Logic ───────────────────────────────────────────────
// Enrich existing shopvox_data with deep scraped data
// Never overwrites basic/pricing/existing data - only adds new fields
function mergeDeepData(existingData: any, svxProduct: SvxProduct): any {
  const merged = { ...existingData };

  // Store the ShopVOX UUID for future UUID-based matching
  merged.svx_uuid = svxProduct.uuid;
  merged.deep_scraped_at = svxProduct.scrapedAt;

  // ── Merge Modifiers ──────────────────────────────────────
  if (svxProduct.modifiers.length > 0) {
    const existingMods: any[] = merged.modifiers || [];
    const scrapedModMap = new Map(
      svxProduct.modifiers.map(m => [m.Name?.toLowerCase(), m])
    );

    // Enrich existing modifier entries with optional + defaultValue
    const enrichedMods = existingMods.map(existing => {
      const key = (existing.name || existing.Name)?.toLowerCase();
      const scraped = scrapedModMap.get(key);
      if (!scraped) return existing;
      return {
        ...existing,
        optional:     scraped.optional !== undefined ? scraped.optional : false,
        defaultValue: scraped.defaultValue ?? existing.default ?? '0',
        type:         scraped.Type || existing.type,
        in_use:       scraped['In Use'] || existing.in_use,
      };
    });

    // Add any modifiers in scraped that weren't in existing
    const existingNames = new Set(existingMods.map(m => (m.name || m.Name)?.toLowerCase()));
    svxProduct.modifiers.forEach(scraped => {
      if (!existingNames.has(scraped.Name?.toLowerCase())) {
        enrichedMods.push({
          name:         scraped.Name,
          type:         scraped.Type,
          in_use:       scraped['In Use'],
          optional:     scraped.optional !== undefined ? scraped.optional : false,
          defaultValue: scraped.defaultValue ?? '0',
        });
      }
    });

    merged.modifiers = enrichedMods;
  }

  // ── Merge Dropdown Menus ─────────────────────────────────
  if (svxProduct.dropdownMenus.length > 0) {
    const existingDDs: any[] = merged.dropdown_menus || [];
    const scrapedDDMap = new Map(
      svxProduct.dropdownMenus.map(d => [d['Menu Name']?.toLowerCase(), d])
    );

    const enrichedDDs = existingDDs.map(existing => {
      const key = (existing.menu_name || existing['Menu Name'])?.toLowerCase();
      const scraped = scrapedDDMap.get(key);
      if (!scraped) return existing;
      return {
        ...existing,
        selected_items:        scraped.selectedItems || [],
        total_selected:        scraped.totalSelected || 0,
        item_type:             scraped['Item Type'] || existing.item_type,
        category:              scraped.item_category || scraped['Item Category' as keyof typeof scraped] || existing.category,
        formula:               scraped.formula ?? existing.formula ?? null,
        multiplier:            scraped.multiplier ?? existing.multiplier ?? null,
        fixed_quantity:        scraped.fixed_quantity ?? existing.fixed_quantity ?? null,
        percentage_of_base:    scraped.percentage_of_base ?? existing.percentage_of_base ?? null,
        charge_per_li_unit:    scraped.charge_per_li_unit ?? existing.charge_per_li_unit ?? null,
        include_in_base_price: scraped.include_in_base_price ?? existing.include_in_base_price ?? null,
        optional:              scraped.optional ?? existing.optional ?? null,
        use_item_per_li_unit:  scraped.use_item_per_li_unit ?? existing.use_item_per_li_unit ?? null,
        attach_num_modifier:   scraped.numeric_modifier ?? existing.attach_num_modifier ?? null,
        attach_chk_modifier:   scraped.checkbox_modifier ?? existing.attach_chk_modifier ?? null,
        reference:             scraped.reference ?? existing.reference ?? null,
      };
    });

    // Add any dropdowns in scraped not in existing
    const existingMenuNames = new Set(existingDDs.map(d => (d.menu_name || d['Menu Name'])?.toLowerCase()));
    svxProduct.dropdownMenus.forEach(scraped => {
      if (!existingMenuNames.has(scraped['Menu Name']?.toLowerCase())) {
        enrichedDDs.push({
          menu_name:             scraped['Menu Name'],
          item_type:             scraped['Item Type'] || null,
          category:              scraped.item_category || null,
          selected_items:        scraped.selectedItems || [],
          total_selected:        scraped.totalSelected || 0,
          formula:               scraped.formula ?? null,
          multiplier:            scraped.multiplier ?? null,
          fixed_quantity:        scraped.fixed_quantity ?? null,
          percentage_of_base:    scraped.percentage_of_base ?? null,
          charge_per_li_unit:    scraped.charge_per_li_unit ?? null,
          include_in_base_price: scraped.include_in_base_price ?? null,
          optional:              scraped.optional ?? null,
          use_item_per_li_unit:  scraped.use_item_per_li_unit ?? null,
          attach_num_modifier:   scraped.numeric_modifier ?? null,
          attach_chk_modifier:   scraped.checkbox_modifier ?? null,
          reference:             scraped.reference ?? null,
        });
      }
    });

    merged.dropdown_menus = enrichedDDs;
  }

  // ── Merge Default Items ──────────────────────────────────
  if (svxProduct.defaultItems.length > 0) {
    const existingDIs: any[] = merged.default_items || [];

    // Default items can have duplicates (e.g. 3x "Hemming Labor" with different formulas)
    // Match by index position within same name group, not just by name
    const nameCount: Record<string, number> = {};
    const enrichedDIs = existingDIs.map(existing => {
      const name = (existing.name || existing.Name)?.toLowerCase();
      nameCount[name] = (nameCount[name] || 0);
      const idx = nameCount[name];
      nameCount[name]++;

      // Find the Nth scraped item with this name
      let matchCount = 0;
      const scraped = svxProduct.defaultItems.find(di => {
        if (di.Name?.toLowerCase() === name) {
          if (matchCount === idx) return true;
          matchCount++;
        }
        return false;
      });

      if (!scraped) return existing;
      return {
        ...existing,
        formula:             scraped.formula,
        multiplier:          scraped.multiplier,
        attach_num_modifier: scraped.attachNumModifier,
        attach_chk_modifier: scraped.attachChkModifier,
        item_type:           scraped['Item Type'] || existing.item_type,
      };
    });

    // Add any default items in scraped not in existing
    const existingDINames = existingDIs.map(d => (d.name || d.Name)?.toLowerCase());
    svxProduct.defaultItems.forEach((scraped, i) => {
      const alreadyHave = existingDINames.filter(n => n === scraped.Name?.toLowerCase()).length;
      const scrapedCount = svxProduct.defaultItems.filter(d => d.Name === scraped.Name).length;
      if (alreadyHave < scrapedCount && i >= existingDINames.length) {
        enrichedDIs.push({
          name:                scraped.Name,
          item_type:           scraped['Item Type'],
          formula:             scraped.formula,
          multiplier:          scraped.multiplier,
          attach_num_modifier: scraped.attachNumModifier,
          attach_chk_modifier: scraped.attachChkModifier,
        });
      }
    });

    merged.default_items = enrichedDIs;
  }

  return merged;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('PrintOS SVX Deep Data Import');
  console.log(DRY_RUN ? '⚠️  DRY RUN MODE - no database changes' : '🔴 LIVE MODE - will update database');
  console.log('='.repeat(60));

  // Load JSON
  const jsonPath = path.resolve(JSON_PATH);
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ JSON file not found: ${jsonPath}`);
    process.exit(1);
  }
  const svxData: Record<string, SvxProduct> = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`✅ Loaded ${Object.keys(svxData).length} products from JSON\n`);

  // Normalize a name for matching: lowercase + collapse whitespace
  const key = (s: string) => s.toLowerCase().trim();

  // Single case-insensitive lookup map
  const svxByName = new Map<string, SvxProduct>();
  for (const [name, product] of Object.entries(svxData)) {
    svxByName.set(key(name), product);
  }

  // Fetch all PrintOS products with shopvox_data
  console.log('Fetching PrintOS products...');
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, migration_status, shopvox_data')
    .not('shopvox_data', 'is', null)
    .order('name');

  if (error) { console.error('❌ Supabase error:', error); process.exit(1); }
  console.log(`✅ Fetched ${products.length} PrintOS products with shopvox_data\n`);

  // Stats
  let matched = 0, skipped = 0, notFound = 0, updated = 0, errors = 0;
  const notFoundList: string[] = [];
  const skippedList:  string[] = [];

  for (const product of products) {
    const printosName  = product.name;
    const svxBasicName = product.shopvox_data?.basic?.name;

    // Skip duplicates
    if (SKIP_NAMES.has(printosName)) {
      console.log(`⏭️  SKIP (duplicate): "${printosName}"`);
      skippedList.push(printosName);
      skipped++;
      continue;
    }

    // Find matching SVX product
    // Priority: match by shopvox_data.basic.name first, then by products.name
    let svxProduct: SvxProduct | undefined;
    let matchedBy = '';

    if (svxBasicName) {
      svxProduct = svxByName.get(key(svxBasicName));
      if (svxProduct) matchedBy = 'basic.name';
    }

    if (!svxProduct) {
      svxProduct = svxByName.get(key(printosName));
      if (svxProduct) matchedBy = 'products.name';
    }

    if (!svxProduct) {
      notFoundList.push(printosName);
      notFound++;
      continue;
    }

    matched++;

    // Merge data
    const enriched = mergeDeepData(product.shopvox_data, svxProduct);

    // Log what we're doing
    const modCount = svxProduct.modifiers.length;
    const ddCount  = svxProduct.dropdownMenus.length;
    const diCount  = svxProduct.defaultItems.length;
    console.log(`✓ [${matchedBy}] "${printosName}" → Mod:${modCount} DD:${ddCount} DI:${diCount}`);

    if (DRY_RUN) {
      updated++;
      continue;
    }

    // Update Supabase
    const { error: updateError } = await supabase
      .from('products')
      .update({ shopvox_data: enriched })
      .eq('id', product.id);

    if (updateError) {
      console.error(`  ❌ Update failed for "${printosName}":`, updateError.message);
      errors++;
    } else {
      updated++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 50));
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('IMPORT COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Matched:   ${matched}`);
  console.log(`✅ Updated:   ${updated}`);
  console.log(`⏭️  Skipped:   ${skipped} (duplicates)`);
  console.log(`❓ Not found: ${notFound} (in JSON but no PrintOS match)`);
  console.log(`❌ Errors:    ${errors}`);

  if (notFoundList.length > 0) {
    console.log('\nNot found in PrintOS (first 20):');
    notFoundList.slice(0, 20).forEach(n => console.log(`  - ${n}`));
    fs.writeFileSync('./svx_import_not_found.json', JSON.stringify(notFoundList, null, 2));
    console.log(`\nFull not-found list saved to: svx_import_not_found.json`);
  }

  if (skippedList.length > 0) {
    console.log('\nSkipped (need manual review):');
    skippedList.forEach(n => console.log(`  - ${n}`));
  }

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN complete - run without --dry-run to apply changes');
  }
}

main().catch(console.error);

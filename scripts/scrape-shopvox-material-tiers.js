// ============================================================
// scrape-shopvox-material-tiers.js
//
// Browser automation script for Claude's javascript_exec tool (or paste
// into DevTools console manually). Uses the same localStorage queue
// pattern as scrape-shopvox-rates.js — each phase is a self-contained
// snippet.
//
// WHY THIS EXISTS: ShopVOX's per-material CSV export (Material_Export_
// List_*.csv, used by scripts/extract-shopvox-products.mjs) does NOT
// carry Pricing Matrix / quantity-break tier data — confirmed by
// inspecting the export format. Tiers live on a per-material sub-page
// (Pricing Matrix tab) and can only be read by visiting each material.
// "Allow Variants" on the material record is NOT a reliable signal for
// whether a material has tiers (confirmed: materials with real tier
// data have allow_variants=false, same as materials with none) — this
// script detects tier presence directly from the Pricing Matrix content
// instead of trusting that flag.
//
// Each material page also has a native "Export Pricing Matrix" button.
// Tried first, as the lower-risk option — it did not produce a
// downloadable file when clicked via automated browser control (no
// network request fired, nothing landed in Downloads), so this script
// (DOM extraction) is the confirmed working path, not just a fallback
// of convenience. A real human click might behave differently; worth
// re-testing manually before assuming it's unusable outright.
//
// ORDER OF OPERATIONS:
//   1. PHASE 1  — Material discovery       (materials list page)
//   2. PHASE 2  — Extraction loop           (auto-navigates each material's
//                                            Pricing Matrix sub-page)
//   3. STATUS CHECK — paste anytime         (any page)
//   4. PHASE 3  — JSON generation           (any page, after COMPLETE)
//   5. RETRIEVE — get the JSON string       (any page)
//
// Each material's Pricing Matrix lives at a real, directly-navigable
// sub-route:
//   https://express.shopvox.com/settings/pricing/materials/{uuid}/pricing-metrics
// This script relies on that route existing rather than clicking a tab,
// since direct navigation was confirmed to work and is far less fragile
// than clicking through Ember-rendered tab controls.
//
// RESUME: if the browser crashes mid-run, navigate back to any
//   material's pricing-metrics page and re-inject PHASE 2. It detects
//   idx > 0 and resumes automatically.
//
// SCOPED RUN: to scrape only specific materials (e.g. a sanity-check
//   dry run), skip PHASE 1 and instead seed the queue by hand:
//     localStorage.setItem('svx_mat_queue', JSON.stringify([
//       { name: 'Digital 12mm LED Screen Panel 1ft x 2ft- Cirrus', uuid: '1b2e5863-ba41-406a-8389-9c7cd26f4d91' },
//       { name: 'Digital 9mm LED Screen Panel 1ft x 2ft- Cirrus',  uuid: '86112df1-eeee-4200-9d86-56667339c9b2' },
//     ]));
//     localStorage.setItem('svx_mat_results', '[]');
//     localStorage.setItem('svx_mat_flat',    '[]');
//     localStorage.setItem('svx_mat_retry',   '[]');
//     localStorage.setItem('svx_mat_idx',     '0');
//     localStorage.setItem('svx_mat_status',  'ready');
//   then run PHASE 2.
// ============================================================


// ============================================================
// PHASE 1 — MATERIAL DISCOVERY
// Run at: https://express.shopvox.com/settings/pricing/materials
// Returns: "PHASE 1 DONE: N materials queued"
// ============================================================

(function discoverMaterials() {
  const loadBtn = Array.from(document.querySelectorAll('*'))
    .find(el => el.children.length === 0 &&
      el.innerText?.includes('Load') && el.innerText?.includes('Remaining'));

  if (loadBtn) {
    loadBtn.click();
    localStorage.setItem('svx_mat_disc_status', 'loading_more');
    setTimeout(discoverMaterials, 4000);
    return;
  }

  const links = Array.from(document.querySelectorAll('a[href*="/settings/pricing/materials/"]'));
  const queue = links.map(l => ({
    name: l.innerText.trim(),
    uuid: l.href.match(/materials\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1],
  })).filter(r => r.uuid && r.name);

  // De-dupe by uuid (list can render more than one link per row)
  const seen = new Set();
  const deduped = queue.filter(r => { if (seen.has(r.uuid)) return false; seen.add(r.uuid); return true; });

  localStorage.setItem('svx_mat_queue',   JSON.stringify(deduped));
  localStorage.setItem('svx_mat_results', '[]');
  localStorage.setItem('svx_mat_flat',    '[]');
  localStorage.setItem('svx_mat_retry',   '[]');
  localStorage.setItem('svx_mat_idx',     '0');
  localStorage.setItem('svx_mat_status',  'ready');

  return 'PHASE 1 DONE: ' + deduped.length + ' materials queued';
})();


// ============================================================
// PHASE 2 — EXTRACTION LOOP
// Run at: any express.shopvox.com page (navigates itself),
//         OR on any material's pricing-metrics page to RESUME after a crash.
//
// Flow per material:
//   navigate to /settings/pricing/materials/{uuid}/pricing-metrics
//     → waitAndRun: polls until "Pricing Matrix" heading is present
//     → classifyAndSave:
//         - "No records." under Variant and Prices  → flat (no tiers), saved to svx_mat_flat
//         - real table rows                          → parsed tiers, saved to svx_mat_results
//         - neither found after timeout               → svx_mat_retry
//     → advances to next material
//
// RESUME: if svx_mat_idx > 0 and status is not COMPLETE, re-injecting
//   this snippet on any page resumes the run.
// ============================================================

const _MAT_MAX_ATTEMPTS = 25; // 1 poll/second = 25 s max wait per page

function _matPageReady() {
  return document.body.innerText.includes('Pricing Matrix');
}

function _matWaitAndRun(onReady, onTimeout) {
  const attempts = parseInt(localStorage.getItem('svx_mat_attempts') || '0');

  if (_matPageReady()) {
    localStorage.setItem('svx_mat_attempts', '0');
    onReady();
    return;
  }

  if (attempts < _MAT_MAX_ATTEMPTS) {
    localStorage.setItem('svx_mat_attempts', String(attempts + 1));
    setTimeout(() => _matWaitAndRun(onReady, onTimeout), 1000);
    return;
  }

  localStorage.setItem('svx_mat_attempts', '0');
  if (onTimeout) onTimeout();
}

function _matNavigateTo(material) {
  localStorage.setItem('svx_mat_attempts', '0');
  window.location.href = `https://express.shopvox.com/settings/pricing/materials/${material.uuid}/pricing-metrics`;
}

function _matAdvanceTo(nextIdx, queue) {
  if (nextIdx < queue.length) {
    localStorage.setItem('svx_mat_idx', String(nextIdx + 1));
    _matNavigateTo(queue[nextIdx]);
    setTimeout(_matRunExtraction, 1500); // give Ember router + data fetch a tick
  } else {
    localStorage.setItem('svx_mat_status', 'COMPLETE');
    const r = JSON.parse(localStorage.getItem('svx_mat_results') || '[]').length;
    const f = JSON.parse(localStorage.getItem('svx_mat_flat')    || '[]').length;
    const b = JSON.parse(localStorage.getItem('svx_mat_retry')   || '[]').length;
    console.log(`EXTRACTION COMPLETE — tiered: ${r}, flat: ${f}, needs retry: ${b}`);
  }
}

// Locates the "Variant and Prices" grid and extracts rows.
//
// IMPORTANT — confirmed by live DOM inspection (javascript_exec against
// the 12mm and 9mm Cirrus panels and the flat Cellular Controller), NOT
// assumed: this grid is NOT a semantic <table>. It's a CSS-module div
// grid (root class matches `_tableExcel_*`), and each cell's real value
// lives in an <input> element (it's an inline-editable spreadsheet grid)
// — reading .innerText on the cell returns an EMPTY STRING even when the
// cell clearly shows a value on screen, because input values aren't part
// of the accessibility/text tree. Must read `input.value` directly.
//
// Structure (root → wrapper → [headerWrapper, contentWrapper]):
//   [class*="_tableExcel_"]            root
//     [child 0]                       wrapper
//       [child 0]                     headerWrapper ("From Qty", "To Qty", "Cost", "Price"...)
//       [child 1]                     contentWrapper (the data rows)
//         [class*="_rowComponent_"]   one per tier row
//           [class*="_contentCell_"]  one per column; cell 0=From Qty, 1=To Qty, 2=Cost, 3=Price
//
// Class names are CSS-module hashes (e.g. `_headerCell_12otk_49`) that
// could change on a ShopVOX redeploy — this is exactly the kind of
// fragility flagged going in. Matched by stable *prefix* substrings
// (`_tableExcel_`, `_rowComponent_`, `_contentCell_`) rather than full
// hashed names, which is the most resilient anchor available without
// access to ShopVOX's source. If ShopVOX ships a redesign, this will
// need re-verifying the same way it was built: javascript_exec against
// a live material page, not guessing.
function _extractPricingMatrix() {
  const root = document.querySelector('[class*="_tableExcel_"]');
  if (!root) {
    return { found: false, reason: 'no_grid_root' };
  }

  const headerText = root.innerText || '';
  if (!/From Qty/i.test(headerText) || !/To Qty/i.test(headerText)) {
    return { found: false, reason: 'grid_missing_from_to_headers' };
  }

  // Flat materials render this exact grid with "No records." in place
  // of rows (confirmed live against Digital LED Screen Cellular
  // Controller- Cirrus, which has no Pricing Matrix data in ShopVOX).
  if (/No records\.?/i.test(root.innerText)) {
    return { found: true, flat: true, tiers: [] };
  }

  const wrapper = root.children[0];
  const body = wrapper?.children[1];
  if (!body) {
    return { found: true, flat: false, tiers: [], error: 'no_body_wrapper' };
  }

  const rows = Array.from(body.querySelectorAll('[class*="_rowComponent_"]'));
  const num = (s) => {
    const n = parseFloat((s || '').replace(/[$,]/g, ''));
    return isNaN(n) ? null : n;
  };
  const cellValue = (cell) => {
    const input = cell?.querySelector('input, textarea');
    return (input ? input.value : cell?.innerText || '').trim();
  };

  const tiers = rows.map((r) => {
    const cells = Array.from(r.querySelectorAll('[class*="_contentCell_"]'));
    const fromRaw = cellValue(cells[0]);
    const toRaw = cellValue(cells[1]);
    return {
      from_qty: num(fromRaw),
      to_qty: toRaw === '' || /^n\/?a$/i.test(toRaw) ? null : num(toRaw),
      cost: num(cellValue(cells[2])),
      price: num(cellValue(cells[3])),
    };
  }).filter((t) => t.from_qty !== null && t.price !== null);

  return { found: true, flat: tiers.length === 0, tiers };
}

function _matClassifyAndSave(currentMaterial, queue, nextIdx) {
  const extraction = _extractPricingMatrix();

  const record = {
    uuid: currentMaterial.uuid,
    name: currentMaterial.name,
    scrapedAt: new Date().toISOString(),
    ...extraction,
  };

  if (!extraction.found) {
    record.needs_retry = true;
    const retry = JSON.parse(localStorage.getItem('svx_mat_retry') || '[]');
    retry.push(record);
    localStorage.setItem('svx_mat_retry', JSON.stringify(retry));
  } else if (extraction.flat) {
    const flat = JSON.parse(localStorage.getItem('svx_mat_flat') || '[]');
    flat.push(record);
    localStorage.setItem('svx_mat_flat', JSON.stringify(flat));
  } else {
    const results = JSON.parse(localStorage.getItem('svx_mat_results') || '[]');
    results.push(record);
    localStorage.setItem('svx_mat_results', JSON.stringify(results));
  }

  localStorage.setItem('svx_mat_progress', nextIdx + '/' + queue.length);
  _matAdvanceTo(nextIdx, queue);
}

function _matRunExtraction() {
  const queue          = JSON.parse(localStorage.getItem('svx_mat_queue')   || '[]');
  const results        = JSON.parse(localStorage.getItem('svx_mat_results') || '[]');
  const flat           = JSON.parse(localStorage.getItem('svx_mat_flat')    || '[]');
  const retry          = JSON.parse(localStorage.getItem('svx_mat_retry')   || '[]');
  const idx            = parseInt(localStorage.getItem('svx_mat_idx')       || '0');
  const currentMaterial = queue[idx - 1]; // we already navigated here

  if (!currentMaterial) {
    console.warn('_matRunExtraction: no currentMaterial at idx', idx);
    return;
  }

  const alreadySaved =
    results.find(r => r.uuid === currentMaterial.uuid) ||
    flat.find(r => r.uuid === currentMaterial.uuid) ||
    retry.find(r => r.uuid === currentMaterial.uuid);
  if (alreadySaved) {
    _matAdvanceTo(idx, queue);
    return;
  }

  _matWaitAndRun(
    () => _matClassifyAndSave(currentMaterial, queue, idx),
    () => {
      console.warn('Timeout waiting for:', currentMaterial.name, '— marking for retry');
      const retryList = JSON.parse(localStorage.getItem('svx_mat_retry') || '[]');
      retryList.push({ uuid: currentMaterial.uuid, name: currentMaterial.name, needs_retry: true, reason: 'page_load_timeout' });
      localStorage.setItem('svx_mat_retry', JSON.stringify(retryList));
      localStorage.setItem('svx_mat_progress', idx + '/' + queue.length);
      _matAdvanceTo(idx, queue);
    }
  );
}

(function startMaterialExtraction() {
  const status = localStorage.getItem('svx_mat_status');
  const idx    = parseInt(localStorage.getItem('svx_mat_idx') || '0');
  const queue  = JSON.parse(localStorage.getItem('svx_mat_queue') || '[]');

  if (status === 'COMPLETE') {
    const r = JSON.parse(localStorage.getItem('svx_mat_results') || '[]').length;
    const f = JSON.parse(localStorage.getItem('svx_mat_flat')    || '[]').length;
    const b = JSON.parse(localStorage.getItem('svx_mat_retry')   || '[]').length;
    return `Already COMPLETE — ${r} tiered, ${f} flat, ${b} need retry. Run PHASE 3 to generate JSON.`;
  }

  if (queue.length === 0) {
    return 'ERROR: No queue found. Run PHASE 1 (or seed a scoped queue manually) first.';
  }

  if (idx > 0) {
    console.log('RESUMING from idx ' + idx + ' / ' + queue.length);
    localStorage.setItem('svx_mat_status', 'running');
    _matRunExtraction();
    return 'RESUMING from ' + idx + '/' + queue.length;
  }

  localStorage.setItem('svx_mat_status',   'running');
  localStorage.setItem('svx_mat_attempts', '0');
  localStorage.setItem('svx_mat_idx',      '1');
  _matNavigateTo(queue[0]);
  setTimeout(_matRunExtraction, 1500);
  return 'STARTING: ' + queue.length + ' materials to process.';
})();


// ============================================================
// STATUS CHECK — paste anytime to see current progress
// ============================================================

JSON.stringify({
  status:      localStorage.getItem('svx_mat_status'),
  progress:    localStorage.getItem('svx_mat_progress'),
  queued:      JSON.parse(localStorage.getItem('svx_mat_queue')   || '[]').length,
  tiered:      JSON.parse(localStorage.getItem('svx_mat_results') || '[]').length,
  flat:        JSON.parse(localStorage.getItem('svx_mat_flat')    || '[]').length,
  needs_retry: JSON.parse(localStorage.getItem('svx_mat_retry')   || '[]').length,
  attempts:    localStorage.getItem('svx_mat_attempts'),
}, null, 2);


// ============================================================
// PHASE 3 — JSON GENERATION
// Run on any page after STATUS CHECK shows "COMPLETE".
// Bundles tiered + flat + retry into one JSON blob for the importer
// script (scripts/import-material-tiers.mjs) to consume.
// ============================================================

(function generateOutput() {
  const output = {
    generatedAt: new Date().toISOString(),
    tiered: JSON.parse(localStorage.getItem('svx_mat_results') || '[]'),
    flat:   JSON.parse(localStorage.getItem('svx_mat_flat')    || '[]'),
    retry:  JSON.parse(localStorage.getItem('svx_mat_retry')   || '[]'),
  };
  localStorage.setItem('svx_mat_output', JSON.stringify(output));
  return `JSON generated: ${output.tiered.length} tiered, ${output.flat.length} flat, ${output.retry.length} need retry.`;
})();


// ============================================================
// RETRIEVE OUTPUT — get the generated JSON string
// Paste into Claude, or use the download snippet below.
// ============================================================

localStorage.getItem('svx_mat_output');


// ============================================================
// DOWNLOAD OUTPUT — trigger a file download of the JSON
// ============================================================

(function downloadOutput() {
  const output = localStorage.getItem('svx_mat_output');
  if (!output) return 'Run PHASE 3 first.';
  const blob = new Blob([output], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `shopvox-material-tiers-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return 'Download triggered.';
})();


// ============================================================
// RESET — clear all svx_mat_* keys and start over
// ============================================================

Object.keys(localStorage)
  .filter(k => k.startsWith('svx_mat_'))
  .forEach(k => localStorage.removeItem(k));
'RESET COMPLETE';

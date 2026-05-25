// ============================================================
// scrape-shopvox-rates.js
//
// Browser automation script for Claude's javascript_exec tool.
// Uses localStorage queue pattern — each phase is a self-contained
// snippet to paste into the browser console or inject via the tool.
//
// ORDER OF OPERATIONS:
//   1. PHASE 1  — Labor rate discovery   (labor-rates list page)
//   2. PHASE 1B — Machine rate discovery  (machine-rates list page)
//   3. PHASE 2  — Extraction loop         (auto-navigates detail pages)
//   4. STATUS CHECK — paste anytime       (any page)
//   5. PHASE 3  — SQL generation          (any page, after COMPLETE)
//   6. RETRIEVE — get the SQL string      (any page)
//
// RESUME: if the browser crashes mid-run, navigate back to any
//   labor-rate or machine-rate detail page and re-inject PHASE 2.
//   It detects idx > 0 and resumes automatically.
// ============================================================


// ============================================================
// PHASE 1 — LABOR RATE DISCOVERY
// Run at: https://express.shopvox.com/settings/pricing (Labor Rates tab)
// Returns: "PHASE 1 DONE: N labor rates queued"
// ============================================================

(function discoverLaborRates() {
  // Click "Load X Remaining Labor Rates" if present, then retry
  const loadBtn = Array.from(document.querySelectorAll('*'))
    .find(el => el.children.length === 0 &&
      el.innerText?.includes('Load') && el.innerText?.includes('Remaining'));

  if (loadBtn) {
    loadBtn.click();
    localStorage.setItem('svx_rates_status', 'loading_more');
    setTimeout(discoverLaborRates, 4000);
    return;
  }

  const links = Array.from(document.querySelectorAll('a[href*="labor-rates/"]'));
  const queue = links.map(l => ({
    name: l.innerText.trim(),
    uuid: l.href.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1],
    type: 'labor',
  })).filter(r => r.uuid && r.name && !r.name.includes('Add New'));

  localStorage.setItem('svx_rates_queue',   JSON.stringify(queue));
  localStorage.setItem('svx_rates_results', '[]');
  localStorage.setItem('svx_rates_retry',   '[]');
  localStorage.setItem('svx_rates_idx',     '0');
  localStorage.setItem('svx_rates_status',  'ready');

  return 'PHASE 1 DONE: ' + queue.length + ' labor rates queued';
})();


// ============================================================
// PHASE 1B — MACHINE RATE DISCOVERY
// Run at: https://express.shopvox.com/settings/pricing (Machine Rates tab)
// Appends to the existing queue from Phase 1.
// Returns: "PHASE 1B DONE: N machine rates added. Total: M"
// ============================================================

(function discoverMachineRates() {
  const loadBtn = Array.from(document.querySelectorAll('*'))
    .find(el => el.children.length === 0 &&
      el.innerText?.includes('Load') && el.innerText?.includes('Remaining'));

  if (loadBtn) {
    loadBtn.click();
    setTimeout(discoverMachineRates, 4000);
    return;
  }

  const links = Array.from(document.querySelectorAll('a[href*="machine-rates/"]'));
  const newItems = links.map(l => ({
    name: l.innerText.trim(),
    uuid: l.href.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1],
    type: 'machine',
  })).filter(r => r.uuid && r.name && !r.name.includes('Add New'));

  const existing = JSON.parse(localStorage.getItem('svx_rates_queue') || '[]');
  localStorage.setItem('svx_rates_queue', JSON.stringify([...existing, ...newItems]));

  return 'PHASE 1B DONE: ' + newItems.length + ' machine rates added. Total: ' + (existing.length + newItems.length);
})();


// ============================================================
// PHASE 2 — EXTRACTION LOOP
// Run at: https://express.shopvox.com/settings/pricing (any tab),
//         OR on any detail page to RESUME after a crash.
//
// Flow per rate:
//   waitAndRun → polls 1 s/tick up to 25 s until page is ready
//     → clicks "Show All Information" if present (waits 1.5 s)
//     → extractAndSave: scrapes fields, checks for all-blank,
//         pushes good records to svx_rates_results,
//         pushes blank/failed records to svx_rates_retry,
//       then navigates to the next rate.
//   On timeout: skips rate → svx_rates_retry, advances queue.
//
// RESUME: if svx_rates_idx > 0 and status is not COMPLETE,
//   re-injecting this snippet on any rate page resumes the run.
// ============================================================

// ── helpers ──────────────────────────────────────────────────

const _MAX_ATTEMPTS = 25; // 1 poll/second = 25 s max wait per page

function _isDetailPageReady() {
  const t = document.body.innerText;
  return t.includes('Production Rate')      ||
         t.includes('Show All Information') ||
         t.includes('Calculations')         ||
         (t.includes('Cost') && t.includes('Price') && t.includes('Formula'));
}

// Polls every 1 s until the detail page content is present,
// then calls onReady(). After MAX_ATTEMPTS calls onTimeout().
// Attempt counter lives in localStorage so it survives across
// async boundaries within a single page load.
function waitAndRun(onReady, onTimeout) {
  const attempts = parseInt(localStorage.getItem('svx_rates_attempts') || '0');

  if (_isDetailPageReady()) {
    localStorage.setItem('svx_rates_attempts', '0');
    onReady();
    return;
  }

  if (attempts < _MAX_ATTEMPTS) {
    localStorage.setItem('svx_rates_attempts', String(attempts + 1));
    setTimeout(() => waitAndRun(onReady, onTimeout), 1000);
    return;
  }

  // Timed out after 25 s — reset counter and hand off to caller
  localStorage.setItem('svx_rates_attempts', '0');
  if (onTimeout) onTimeout();
}

// Navigate to a rate's detail page, resetting the attempt counter
// so waitAndRun starts fresh on the new page.
function _navigateTo(rate) {
  localStorage.setItem('svx_rates_attempts', '0');
  const baseUrl = rate.type === 'labor'
    ? 'https://express.shopvox.com/settings/pricing/labor-rates/'
    : 'https://express.shopvox.com/settings/pricing/machine-rates/';
  // Prefer Ember link click to avoid a full page reload
  const link = Array.from(document.querySelectorAll('a'))
    .find(a => a.href.includes(rate.uuid));
  if (link) {
    link.click();
  } else {
    window.location.href = baseUrl + rate.uuid;
  }
}

// Advance to the next rate in the queue, or mark COMPLETE.
function _advanceTo(nextIdx, queue) {
  if (nextIdx < queue.length) {
    localStorage.setItem('svx_rates_idx', String(nextIdx + 1));
    _navigateTo(queue[nextIdx]);
    setTimeout(_runExtraction, 1000); // give Ember router a tick
  } else {
    localStorage.setItem('svx_rates_status', 'COMPLETE');
    const r = JSON.parse(localStorage.getItem('svx_rates_results') || '[]').length;
    const b = JSON.parse(localStorage.getItem('svx_rates_retry')   || '[]').length;
    console.log('EXTRACTION COMPLETE — saved: ' + r + ', needs retry: ' + b);
  }
}

// Scrape the current page for the given rate, classify the result,
// then advance the queue.
function extractAndSave(currentRate, queue, nextIdx) {
  const text = document.body.innerText;

  const getField = (label) => {
    const pos = text.indexOf(label);
    if (pos === -1) return '';
    return text.slice(pos + label.length, pos + label.length + 150)
      .trim().split('\n')[0].trim().replace(/^\$/, '').trim();
  };

  const scraped = {
    uuid:                 currentRate.uuid,
    name:                 currentRate.name,
    type:                 currentRate.type,
    // Calculations section
    formula:              getField('Formula\n')               || getField('Formula '),
    units:                getField('Units\n')                 || getField('Units '),
    include_in_base_price: getField('Include in Base Price\n'),
    per_li_unit:          getField('Per LI Unit\n'),
    // Production Rate section (revealed by Show All Information)
    production_rate:      getField('Production Rate\n')       || getField('Production Rate '),
    prod_rate_units:      getField('Prod. Rate Units\n')      || getField('Prod. Rate Units '),
    production_factor:    getField('Production Factor\n'),
    // Charges
    setup_charge:         getField('Setup Charge\n'),
    machine_charge:       getField('Machine Charge\n'),
    other_charge:         getField('Other Charge\n'),
    operator_attendance:  getField('Operator Attendance %\n') || getField('Operator Attendance'),
    // Flags
    show_internal:        getField('Show Internal\n'),
    // Notes
    about:                getField('About This Labor Rate\n') || getField('About This Machine Rate\n'),
    // Raw context window for debugging
    raw_snippet: text.slice(
      Math.max(0, text.indexOf(currentRate.name) - 50),
      Math.min(text.length, text.indexOf(currentRate.name) + 800)
    ),
  };

  // ── Blank-field check ────────────────────────────────────────
  // If ALL three key fields are empty the page probably didn't load
  // properly. Route to svx_rates_retry instead of results so we can
  // re-run just these after the main pass completes.
  const allBlank = !scraped.production_rate && !scraped.formula && !scraped.units;

  if (allBlank) {
    scraped.needs_retry = true;
    const retry = JSON.parse(localStorage.getItem('svx_rates_retry') || '[]');
    retry.push(scraped);
    localStorage.setItem('svx_rates_retry', JSON.stringify(retry));
  } else {
    const results = JSON.parse(localStorage.getItem('svx_rates_results') || '[]');
    results.push(scraped);
    localStorage.setItem('svx_rates_results', JSON.stringify(results));
  }

  localStorage.setItem('svx_rates_progress', nextIdx + '/' + queue.length);
  _advanceTo(nextIdx, queue);
}

// Called each time a new detail page is ready to process.
function _runExtraction() {
  const queue       = JSON.parse(localStorage.getItem('svx_rates_queue')   || '[]');
  const results     = JSON.parse(localStorage.getItem('svx_rates_results') || '[]');
  const retry       = JSON.parse(localStorage.getItem('svx_rates_retry')   || '[]');
  const idx         = parseInt(localStorage.getItem('svx_rates_idx')       || '0');
  const currentRate = queue[idx - 1]; // we already navigated here

  if (!currentRate) {
    console.warn('_runExtraction: no currentRate at idx', idx);
    return;
  }

  // Skip if already saved (handles re-inject on same page)
  const alreadySaved =
    results.find(r => r.uuid === currentRate.uuid) ||
    retry.find(r => r.uuid === currentRate.uuid);
  if (alreadySaved) {
    _advanceTo(idx, queue);
    return;
  }

  waitAndRun(
    // ── onReady ────────────────────────────────────────────────
    () => {
      const showAllBtn = Array.from(document.querySelectorAll('*'))
        .find(el => el.children.length === 0 &&
          el.innerText?.trim() === 'Show All Information');

      if (showAllBtn) {
        showAllBtn.click();
        // Wait for the extra fields to render before extracting
        setTimeout(() => extractAndSave(currentRate, queue, idx), 1500);
      } else {
        extractAndSave(currentRate, queue, idx);
      }
    },
    // ── onTimeout (25 s elapsed, page never became ready) ──────
    () => {
      console.warn('Timeout waiting for:', currentRate.name, '— marking for retry');
      const retryList = JSON.parse(localStorage.getItem('svx_rates_retry') || '[]');
      retryList.push({ ...currentRate, needs_retry: true, reason: 'page_load_timeout' });
      localStorage.setItem('svx_rates_retry', JSON.stringify(retryList));
      localStorage.setItem('svx_rates_progress', idx + '/' + queue.length);
      _advanceTo(idx, queue);
    }
  );
}

// ── PHASE 2 entry point ──────────────────────────────────────
(function startExtraction() {
  const status = localStorage.getItem('svx_rates_status');
  const idx    = parseInt(localStorage.getItem('svx_rates_idx') || '0');
  const queue  = JSON.parse(localStorage.getItem('svx_rates_queue') || '[]');

  if (status === 'COMPLETE') {
    const r = JSON.parse(localStorage.getItem('svx_rates_results') || '[]').length;
    const b = JSON.parse(localStorage.getItem('svx_rates_retry')   || '[]').length;
    return 'Already COMPLETE — ' + r + ' saved, ' + b + ' need retry. Run PHASE 3 to generate SQL.';
  }

  if (queue.length === 0) {
    return 'ERROR: No queue found. Run PHASE 1 and PHASE 1B first.';
  }

  // ── RESUME: queue exists and we're past the first item ───────
  // Handles browser crashes — just navigate to any rate page and
  // re-inject this snippet. It picks up at the last saved position.
  if (idx > 0) {
    console.log('RESUMING from idx ' + idx + ' / ' + queue.length);
    localStorage.setItem('svx_rates_status', 'running');
    _runExtraction();
    return 'RESUMING from ' + idx + '/' + queue.length;
  }

  // ── Fresh start ───────────────────────────────────────────────
  localStorage.setItem('svx_rates_status',   'running');
  localStorage.setItem('svx_rates_attempts', '0');
  localStorage.setItem('svx_rates_idx',      '1');
  _navigateTo(queue[0]);
  setTimeout(_runExtraction, 1000);
  return 'STARTING: ' + queue.length + ' rates to process.';
})();


// ============================================================
// STATUS CHECK — paste anytime to see current progress
// ============================================================

JSON.stringify({
  status:      localStorage.getItem('svx_rates_status'),
  progress:    localStorage.getItem('svx_rates_progress'),
  queued:      JSON.parse(localStorage.getItem('svx_rates_queue')   || '[]').length,
  scraped:     JSON.parse(localStorage.getItem('svx_rates_results') || '[]').length,
  needs_retry: JSON.parse(localStorage.getItem('svx_rates_retry')   || '[]').length,
  attempts:    localStorage.getItem('svx_rates_attempts'),
}, null, 2);


// ============================================================
// PHASE 3 — SQL GENERATION
// Run on any page after STATUS CHECK shows "COMPLETE".
// Generates UPDATE statements from svx_rates_results only
// (retry records are excluded until re-run succeeds).
// Returns: "SQL generated: N rates. Labor: X, Machine: Y"
// SQL stored in localStorage under svx_rates_sql.
// ============================================================

(function generateSQL() {
  const results = JSON.parse(localStorage.getItem('svx_rates_results') || '[]');

  function esc(s) { return (s || '').replace(/'/g, "''"); }
  function num(s, def) { const n = parseFloat(s); return isNaN(n) ? def : n; }
  function bool(s) { return (s || '').toLowerCase() === 'yes' ? 'true' : 'false'; }

  const laborUpdates = results.filter(r => r.type === 'labor').map(r =>
    `UPDATE labor_rates SET ` +
    `formula='${esc(r.formula?.trim() || 'Unit')}', ` +
    `units='${esc(r.units?.trim() || 'Hr')}', ` +
    `production_rate=${num(r.production_rate, 0)}, ` +
    `prod_rate_units='${esc(r.prod_rate_units?.trim())}', ` +
    `production_factor=${num(r.production_factor, 1)}, ` +
    `setup_charge=${num(r.setup_charge, 0)}, ` +
    `other_charge=${num(r.other_charge, 0)}, ` +
    `operator_attendance=${num(r.operator_attendance, 100)}, ` +
    `show_internal=${bool(r.show_internal)}, ` +
    `per_li_unit=${bool(r.per_li_unit)} ` +
    `WHERE name='${esc(r.name)}';`
  ).join('\n');

  const machineUpdates = results.filter(r => r.type === 'machine').map(r =>
    `UPDATE machine_rates SET ` +
    `formula='${esc(r.formula?.trim() || 'Unit')}', ` +
    `units='${esc(r.units?.trim() || 'Hr')}', ` +
    `production_rate=${num(r.production_rate, 0)}, ` +
    `prod_rate_units='${esc(r.prod_rate_units?.trim())}', ` +
    `production_factor=${num(r.production_factor, 1)}, ` +
    `setup_charge=${num(r.setup_charge, 0)}, ` +
    `other_charge=${num(r.other_charge, 0)}, ` +
    `show_internal=${bool(r.show_internal)}, ` +
    `per_li_unit=${bool(r.per_li_unit)} ` +
    `WHERE name='${esc(r.name)}';`
  ).join('\n');

  const retryList = JSON.parse(localStorage.getItem('svx_rates_retry') || '[]');
  const retryComment = retryList.length > 0
    ? '\n\n-- !! ' + retryList.length + ' rate(s) need retry (blank fields or page timeout):\n' +
      retryList.map(r => '--   [' + r.type + '] ' + r.name + (r.reason ? ' (' + r.reason + ')' : '')).join('\n')
    : '';

  const fullSQL =
    '-- Labor Rate Updates\n' + (laborUpdates || '-- (none)') +
    '\n\n-- Machine Rate Updates\n' + (machineUpdates || '-- (none)') +
    retryComment;

  localStorage.setItem('svx_rates_sql', fullSQL);

  return 'SQL generated: ' + results.length + ' rates. ' +
    'Labor: '        + results.filter(r => r.type === 'labor').length +
    ', Machine: '    + results.filter(r => r.type === 'machine').length +
    ', Needs retry: ' + retryList.length;
})();


// ============================================================
// PHASE 2 RETRY — re-run just the failed rates
// Copy svx_rates_retry back into the queue, reset idx, and
// re-inject PHASE 2. Run this after the main pass completes.
// ============================================================

(function rerunRetries() {
  const retry = JSON.parse(localStorage.getItem('svx_rates_retry') || '[]');
  if (retry.length === 0) return 'No retry items — nothing to do.';

  localStorage.setItem('svx_rates_queue',   JSON.stringify(retry));
  localStorage.setItem('svx_rates_retry',   '[]');
  localStorage.setItem('svx_rates_idx',     '0');
  localStorage.setItem('svx_rates_status',  'ready');
  localStorage.setItem('svx_rates_attempts', '0');

  return 'RETRY QUEUE SET: ' + retry.length + ' rates. Now re-inject PHASE 2.';
})();


// ============================================================
// RETRIEVE RESULTS — get the generated SQL string
// Paste into Claude or copy to clipboard.
// ============================================================

localStorage.getItem('svx_rates_sql');


// ============================================================
// RETRIEVE RAW JSON — inspect all scraped rate objects
// ============================================================

localStorage.getItem('svx_rates_results');


// ============================================================
// RETRIEVE RETRY LIST — see which rates need re-running
// ============================================================

localStorage.getItem('svx_rates_retry');


// ============================================================
// RESET — clear all svx_rates_* keys and start over
// ============================================================

Object.keys(localStorage)
  .filter(k => k.startsWith('svx_rates_'))
  .forEach(k => localStorage.removeItem(k));
'RESET COMPLETE';

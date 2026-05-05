// shopvox-find-missed-customers.js
// Paste into DevTools console on https://express.shopvox.com/customers
//
// PURPOSE: Find ShopVOX UUIDs for 142 customers that were missed in the
//          May 4 scrape, then populate svx_queue with ONLY those UUIDs
//          so the normal svx-auto-inject.js Phase 2 can scrape just them.
//
// DOES NOT TOUCH: svx_contacts (existing 7,575 contacts are preserved)
//
// USAGE:
//   1. Go to https://express.shopvox.com/customers
//   2. Paste this script → Enter
//   3. Wait ~3 min for Phase A (Load More clicks) to finish
//   4. Review match report in console
//   5. Then paste svx-auto-inject.js launcher to scrape the ~142 (~25 min)
//
// ABORT: localStorage.removeItem('svx_queue')

;(async function svxFindMissed() {
  const DELAY = (ms) => new Promise((r) => setTimeout(r, ms))

  // ── 142 missing company names from PrintOS (from Supabase CSV) ───────────────
  // Source: "Supabase Snippet Companies Without Customer Contacts.csv"
  const MISSING_NAMES = [
    '@Grace Hair Salon',
    '@Work Personnel',
    'Alberto Lopez',
    'Alejandro Saenz',
    'AlmaDura Global Transportation',
    "Alvarado's Truck Trailer Repair",
    'American Communications & Utility LLC.',
    'American Red Cross',
    'AmeriCorp Insurance Group LLC',
    'Amparts San Antonio',
    'Ana Jimenez',
    "Andy's Mobility Lift Service",
    'Angel Guajardo',
    'Apply-Tek LLC',
    'Arandas Iron Works',
    'ARC Express Inc.',
    'Archer Printing and Promo',
    'Armando Garza & Sons',
    'Aroi Thai & Sushi',
    'ATC Transport LLC.',
    'Auto Buses Latinos Inc.',
    'AutoZone',
    'Barry Cup LLC',
    'Beaded By Sandy',
    'Bear Paw Pressure Washing',
    'Beldon Roofing Company',
    'Bella Esquenazi',
    'Border Transit Logistic',
    'Bruni Energy Corp.',
    'Bruno Diaz Insurance Agency',
    'Bull Transportation',
    'C3 Pathways',
    'Cabello Recovery',
    'Canna Shack',
    'Casa de Refugio',
    'Cassal Diseno',
    'Cassandra Martinez',
    'Castillo Electric & Facility Services',
    'Celadon Trucking Services',
    'Chamber Of Commerce Freer',
    'Cindy Rubio',
    'City of El Cenizo',
    'City of Laredo',
    'City of Laredo Health Larga Vista WIC',
    'Clutch Ground Logistics',
    'CNJ Trucking INC',
    'Cobalt Construction',
    'Commerce Bank',
    'Corpus Christi Sign Company',
    'Daphne Art Foundation',
    'EAS Trading, LLC',
    'Eddie Zavala',
    'Eduardo Lozano',
    'El Cenizo Police',
    'Emilo Tomcat Auto Sales',
    'Evolve Fitness',
    'Fire Media Tv',
    'Gabriel Lopez Campaign',
    'Gadi Fowarding Inc.',
    'Glamour Charm School',
    'Guerra Auto Sales',
    'H Salinas',
    'Joel Monita',
    'Julian Quesada',
    'La Charcuteria',
    'Lazyboy Tattoos',
    'Leonardo Alvarado',
    'Leonelo Cruz Real Estate Company',
    'Luis Sotelo',
    'Mario Rodriguez',
    'Martin Alvarado',
    'Mary De Sylva',
    'Midas',
    'Mini Storage',
    'Nail Creations',
    'Nearshoring Transportation LLC',
    'Nezt Real Estate Group',
    'Norgua Ventures L.T.D.',
    "Oreily's Auto Parts",
    'P&N Radio & Tv Advertising, LLC',
    'Pain Consultants of Texas',
    'Patricia, Garcia',
    'Patmo Solar',
    'Print Place',
    'Pro Tech Computers',
    'Pump n Shop 83 Zapata Hwy',
    'Pump n Shop Freer',
    'Pump n Shop Park & Santa Ursula',
    'Pump n Shop Saunders & McPherson',
    'Pump n Shop Springfield',
    'Pump n Shop Zapata',
    'Pumpd Nutrition',
    'Quarter Mile, Inc.',
    'Quick Car Service',
    'Radio Rama',
    'Ralph Morales',
    'Raul Martinez',
    'Reyes Strategic',
    "Rockin'WC services",
    "Roy's Palms",
    'SBC Transportation, Inc.',
    'Scriptum',
    'Sean Callahan',
    'Simri Farfan',
    'Solar Screens Of South Laredo',
    'South Texas International Raceway',
    'South Texas Marketing Group',
    'Steinholz Construction',
    'Sweet In Every Bite',
    'T.P Houston Sur LLC',
    'Team I/T',
    'Texas A&M AgriLife Extension-Webb County',
    'Texas Elite Realty Group',
    'Texas Senior Med Clinic',
    'Texas Stained',
    'The Beauty Bar',
    'Theraputic Body Works',
    'Thunderbird Auto Finance',
    'Thunderbird Marketing/ Sames Kia',
    'Top Site Civil Group',
    'Tori Canal Sur',
    'Toyota Lift of South Texas Corpus Christi',
    'TP Arena',
    'TP Houston Sur, LLC',
    'TP New Braunfels, LLC',
    'TP Saunders LLC',
    'Tp Weslaco LLC',
    'Triple V Hotshot Services',
    'Umbrella Logistic',
    'US Intermodal',
    'Victory Express LLC',
    'Vix Medical Equipment',
    'Walk to End Alzheimer\'s - Laredo',
    'Webb County Clerk',
    'Webb County Constable Pct. 4',
    'Webb County Court at Law #1',
    'Webb County Democratic Party',
    'Webb County Tax Office',
    'Whataburger',
    'Wind Tree Plaza at San Isidro',
    'Windfield Communities',
    'X Fit Reloaded',
    'Zarsky Lumber Co.',
  ]

  // Normalise for fuzzy matching: lowercase, collapse whitespace, strip punctuation
  function norm(s) {
    return (s ?? '').toLowerCase().trim()
      .replace(/['']/g, "'")      // smart quotes → straight
      .replace(/\s+/g, ' ')
  }

  const missingNorm = new Map(MISSING_NAMES.map((n) => [norm(n), n]))

  console.log(`%c[svx-missed] Looking for ${MISSING_NAMES.length} missing customers`, 'color:#06c;font-weight:bold')
  console.log('[svx-missed] Phase A — walking customer list via Load More clicks (~3 min)…')

  // ── Phase A: Walk the full customer list, build UUID → name map ───────────────

  const UUID_RE   = /\/customers\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
  const uuidToName = new Map()   // uuid → display name as seen in ShopVOX

  function harvestRows() {
    // Each row: <a href="/customers/{uuid}"> somewhere in a row container.
    // Grab the anchor, then look for the company name in the closest
    // meaningful ancestor (tr, or a generic row div).
    document.querySelectorAll('a[href*="/customers/"]').forEach((a) => {
      const m = a.getAttribute('href').match(UUID_RE)
      if (!m) return
      const uuid = m[1]
      if (uuidToName.has(uuid)) return   // already captured

      // Walk up to find the row container and extract the text closest to the link
      const row = a.closest('tr, [class*="row" i], [class*="item" i], li') ?? a.parentElement
      // Prefer the anchor's own text; fall back to the row's first meaningful text node
      const name = (a.textContent.trim() || row?.textContent.trim() || '').split('\n')[0].trim()
      if (name) uuidToName.set(uuid, name)
    })
  }

  function getLoadMoreBtn() {
    return [...document.querySelectorAll('button')].find((b) => {
      const t = b.textContent.toLowerCase()
      return t.includes('load') && t.includes('more') && b.offsetParent !== null
    }) ?? null
  }

  const MAX_CLICKS = 200
  let staleRounds  = 0
  let lastCount    = 0
  harvestRows()

  for (let i = 0; i < MAX_CLICKS; i++) {
    let btn = getLoadMoreBtn()

    if (!btn) {
      // Retry up to 4× before giving up (slow loads)
      let found = false
      for (let r = 0; r < 4; r++) {
        console.log(`[svx-missed] No button — retry ${r + 1}/4`)
        await DELAY(2000)
        window.scrollTo(0, document.body.scrollHeight)
        await DELAY(1000)
        btn = getLoadMoreBtn()
        if (btn) { found = true; break }
      }
      if (!found) {
        console.log(`[svx-missed] List fully loaded after ${i} clicks, ${uuidToName.size} UUIDs harvested`)
        break
      }
    }

    btn.scrollIntoView({ block: 'center' })
    await DELAY(300)
    btn.click()
    await DELAY(2500)
    harvestRows()

    const current = uuidToName.size
    if (i % 10 === 0) console.log(`[svx-missed] Click ${i + 1}: ${current} UUIDs in map`)

    if (current === lastCount) {
      staleRounds++
      if (staleRounds >= 2) { console.log('[svx-missed] Count stable — done loading'); break }
    } else {
      staleRounds = 0
      lastCount   = current
    }
  }

  harvestRows()   // final pass
  console.log(`[svx-missed] Phase A complete — ${uuidToName.size} total UUIDs mapped`)

  // ── Phase B: Match missing names → ShopVOX UUIDs ─────────────────────────────

  // Build reverse map: norm(name) → uuid
  const nameToUuid = new Map()
  uuidToName.forEach((name, uuid) => {
    nameToUuid.set(norm(name), uuid)
  })

  const matchedQueue = []
  const unmatched    = []

  for (const [normalised, original] of missingNorm) {
    // Exact normalised match first
    let uuid = nameToUuid.get(normalised)

    // Fuzzy fallback: check if any ShopVOX name starts with or contains the target
    if (!uuid) {
      for (const [svxNorm, svxUuid] of nameToUuid) {
        if (svxNorm.includes(normalised) || normalised.includes(svxNorm)) {
          uuid = svxUuid
          break
        }
      }
    }

    if (uuid) {
      matchedQueue.push(uuid)
    } else {
      unmatched.push(original)
    }
  }

  // ── Phase C: Save targeted queue, preserve existing contacts ─────────────────

  // CRITICAL: do NOT clear svx_contacts — existing 7,575 contacts are preserved
  localStorage.setItem('svx_queue', JSON.stringify(matchedQueue))
  localStorage.setItem('svx_progress', JSON.stringify({ index: 0 }))
  localStorage.removeItem('svx_scraper_active')   // don't auto-start

  // ── Report ────────────────────────────────────────────────────────────────────

  console.log('%c\n══════════════════════════════════════', 'color:#06c')
  console.log(`%c  MATCH REPORT`, 'color:#06c;font-weight:bold;font-size:14px')
  console.log('%c══════════════════════════════════════', 'color:#06c')
  console.log(`%c  Matched   : ${matchedQueue.length} / ${MISSING_NAMES.length}`, 'color:#0a7;font-weight:bold')
  console.log(`%c  Unmatched : ${unmatched.length}`, unmatched.length ? 'color:#c00;font-weight:bold' : 'color:#0a7')

  if (unmatched.length > 0) {
    console.log('%c\n  Unmatched names (name differs between PrintOS ↔ ShopVOX):', 'color:#c00')
    unmatched.forEach((n) => console.log(`    • ${n}`))
  }

  console.log('%c\n══════════════════════════════════════', 'color:#06c')
  console.log(`%c  svx_queue set to ${matchedQueue.length} UUIDs`, 'color:#0a7;font-weight:bold')
  console.log('%c  svx_contacts UNTOUCHED (7,575 existing contacts preserved)', 'color:#0a7')
  console.log('%c\n  NEXT STEP:', 'color:#06c;font-weight:bold')
  console.log('%c  Set scraper active and navigate to first customer:', 'color:#06c')
  console.log(`%c  localStorage.setItem('svx_scraper_active', '1')`, 'color:#888')
  console.log(`%c  const q = JSON.parse(localStorage.getItem('svx_queue'))`, 'color:#888')
  console.log(`%c  window.location.href = 'https://express.shopvox.com/customers/' + q[0]`, 'color:#888')
  console.log(`%c\n  Expected runtime: ~${Math.ceil(matchedQueue.length * 10 / 60)} min`, 'color:#06c')
  console.log('%c══════════════════════════════════════\n', 'color:#06c')

  // Verify: show current svx_contacts count for confidence
  const existingContacts = JSON.parse(localStorage.getItem('svx_contacts') || '[]')
  console.log(`[svx-missed] Verification: svx_contacts has ${existingContacts.length} entries (should be 7575)`)
})()

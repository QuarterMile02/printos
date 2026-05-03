// svx-auto-inject.js — auto-injected by Chrome "User JavaScript" extension
// on every page matching: https://express.shopvox.com/customers/*
//
// ARCHITECTURE: one execution per page load, chains via real browser navigation.
//   page loads → script runs once → saves → window.location.href = next → repeat
//   No while loop. No pushState. localStorage writes are synchronous and complete
//   before navigation tears down the JS context.
//
// STORAGE KEYS:
//   svx_queue          — string[] of customer UUIDs (set by Phase 1)
//   svx_contacts       — Contact[] accumulated results
//   svx_progress       — { index: N } position in queue
//   svx_scraper_active — '1' while running, absent when done/aborted
//
// LAUNCHER (paste once to start Phase 2):
//   localStorage.setItem('svx_progress', JSON.stringify({ index: 0 }));
//   localStorage.setItem('svx_scraper_active', '1');
//   const q = JSON.parse(localStorage.getItem('svx_queue'));
//   window.location.href = 'https://express.shopvox.com/customers/' + q[0];
//
// ABORT:   localStorage.removeItem('svx_scraper_active')
// CHECK:   JSON.parse(localStorage.getItem('svx_contacts') || '[]').length

;(async function svxAutoInject() {
  const DELAY = (ms) => new Promise((r) => setTimeout(r, ms))

  // ── 1. Gate: only run when scraper is active ──────────────────────────────────
  if (localStorage.getItem('svx_scraper_active') !== '1') return

  // ── 2. Gate: must be on a customer detail page, not the list ─────────────────
  const UUID_RE  = /\/customers\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
  const uuidMatch = window.location.pathname.match(UUID_RE)
  if (!uuidMatch) return   // list page or unrelated URL
  const uuid = uuidMatch[1]

  console.log(`[svx-inject] page: ${uuid}`)

  // ── 3. Wait for React to finish rendering the customer detail ─────────────────
  async function waitForPageReady(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (document.querySelector('h1, [data-testid="customer-name"], .customer-name')) return true
      await DELAY(300)
    }
    console.warn('[svx-inject] page ready timeout — proceeding anyway')
    return false
  }

  await waitForPageReady()
  await DELAY(500)   // extra settle time for lazy-loaded contact sections

  // ── 4. Expand all contacts: "Show All" then "Load N Remaining" ──────────────
  async function expandAllContacts() {
    // Step 1: click "Show All" (guarded to Contacts section only)
    const showAllSpan = [...document.querySelectorAll('span')]
      .find((s) => s.textContent.trim() === 'Show All')
    const showAllBtn = showAllSpan?.closest('button')
    const section    = showAllSpan?.closest('section, div[class*="Contact"], div')
    if (showAllSpan && showAllBtn && section?.textContent.includes('Contacts')) {
      showAllBtn.click()
      console.log('[svx-inject] "Show All" clicked')
      await DELAY(1500)
    }

    // Step 2: click "Load N Remaining Contacts" until it disappears
    // Loop up to 5× for very large contact lists
    for (let i = 0; i < 5; i++) {
      const loadMoreSpan = [...document.querySelectorAll('span')]
        .find((s) => /^Load \d+ Remaining Contacts?$/i.test(s.textContent.trim()))
      if (!loadMoreSpan) break
      const loadMoreBtn = loadMoreSpan.closest('button')
      if (!loadMoreBtn) break
      loadMoreBtn.scrollIntoView({ block: 'center' })
      await DELAY(300)
      loadMoreBtn.click()
      console.log(`[svx-inject] "Load Remaining" click ${i + 1} — waiting for render`)
      await DELAY(2000)
    }
  }

  // ── 5. Extract contacts using confirmed DOM structure (div.ml4 names) ─────────
  function extractContacts(customerId) {
    const company = document.querySelector('h1')?.textContent.trim() ?? ''

    const nameDivs   = [...document.querySelectorAll('div.ml4')]
    const contacts   = []

    for (const nameDiv of nameDivs) {
      const name = nameDiv.textContent.trim()
      if (!name || name.length < 2 || name.length > 80) continue

      // Walk up to the enclosing contact row
      const row = nameDiv.closest('tr, [class*="row" i], [class*="contact" i]')
               ?? nameDiv.parentElement?.parentElement
      if (!row) continue

      const rowText = row.innerText ?? ''
      const email   = (rowText.match(/[\w.+-]+@[\w.-]+\.\w{2,}/) || [])[0] ?? null
      const phone   = (rowText.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/) || [])[0] ?? null

      // Skip UI labels: only keep rows that have an email, phone, or a known role label
      if (!email && !phone && !/Primary|Account Payable/i.test(rowText)) continue

      const parts = name.split(' ')
      contacts.push({
        customerId,
        company_name: company,
        full_name:    name,
        first_name:   parts[0] ?? null,
        last_name:    parts.slice(1).join(' ') || null,
        email,
        phone,
        is_primary:   /primary/i.test(rowText),
        is_ap:        /account payable/i.test(rowText),
      })
    }

    // Dedupe by full_name
    const seen = new Set()
    return contacts.filter((c) => {
      if (seen.has(c.full_name)) return false
      seen.add(c.full_name)
      return true
    })
  }

  await expandAllContacts()

  const newContacts = extractContacts(uuid)
  console.log(`[svx-inject] extracted ${newContacts.length} contact(s) from ${uuid}`)

  // ── 6–8. Save to localStorage (synchronous — completes before navigation) ────
  try {
    const all = JSON.parse(localStorage.getItem('svx_contacts') || '[]')
    all.push(...newContacts)
    localStorage.setItem('svx_contacts', JSON.stringify(all))
    console.log(`[svx-inject] svx_contacts saved — ${all.length} total`)
  } catch (e) {
    console.error('[svx-inject] FAILED to save svx_contacts:', e.message, e)
  }

  let nextIndex
  try {
    const progress = JSON.parse(localStorage.getItem('svx_progress') || '{"index":0}')
    progress.index++
    nextIndex = progress.index
    localStorage.setItem('svx_progress', JSON.stringify(progress))
    console.log(`[svx-inject] svx_progress saved — index ${nextIndex}`)
  } catch (e) {
    console.error('[svx-inject] FAILED to save svx_progress:', e.message, e)
    return
  }

  // ── 9–10. Navigate to next customer (real nav, not pushState) ────────────────
  const queue    = JSON.parse(localStorage.getItem('svx_queue') || '[]')
  const nextUuid = queue[nextIndex]

  if (!nextUuid) {
    // ── Done ──────────────────────────────────────────────────────────────────
    localStorage.removeItem('svx_scraper_active')
    const all = JSON.parse(localStorage.getItem('svx_contacts') || '[]')
    console.log(
      `%c[svx-inject] ✓ Complete — ${all.length} contacts from ${queue.length} customers`,
      'color:#0a7;font-weight:bold;font-size:14px',
    )
    // Trigger download
    const blob = new Blob([JSON.stringify({ contacts: all }, null, 2)], { type: 'application/json' })
    const a    = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(blob),
      download: `shopvox-contacts-${new Date().toISOString().slice(0, 10)}.json`,
    })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    return
  }

  // All localStorage writes are synchronous and already committed.
  // Safe to navigate now.
  console.log(`[svx-inject] navigating to customer ${nextIndex + 1}/${queue.length}`)
  window.location.href = `${window.location.origin}/customers/${nextUuid}`
})()

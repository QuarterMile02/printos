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

  // ── 4. Click "Show All" for Contacts section only ────────────────────────────
  // Two "Show All" buttons exist (Contacts + Addresses).
  // Match by span text, walk to button parent, guard on section containing "Contacts".
  function clickShowAllContacts() {
    const showAllSpan = [...document.querySelectorAll('span')]
      .find((s) => s.textContent.trim() === 'Show All')
    const showAllBtn = showAllSpan?.closest('button')
    const section    = showAllSpan?.closest('section, div[class*="Contact"], div')
    if (showAllSpan && showAllBtn && section?.textContent.includes('Contacts')) {
      showAllBtn.click()
      return true
    }
    return false
  }

  const clicked = clickShowAllContacts()
  if (clicked) {
    console.log('[svx-inject] "Show All" clicked — waiting for contacts to render')
    await DELAY(1500)
  }

  // ── 5. Extract contacts from this page ────────────────────────────────────────
  function extractContacts(customerId) {
    const company = (
      document.querySelector('h1, [data-testid="customer-name"], .customer-name')
        ?.textContent ?? ''
    ).trim()

    const selectors = [
      '[data-testid="contact-row"]',
      '.contact-row',
      '[data-section="contacts"] tr',
      '#contacts-section tr',
      'table[aria-label*="contact" i] tr',
    ]
    let rows = []
    for (const sel of selectors) {
      rows = Array.from(document.querySelectorAll(sel))
      if (rows.length > 0) break
    }

    if (rows.length === 0) {
      // Fallback: pull email addresses from visible page text
      const emails = [...document.body.innerText.matchAll(/[\w.+-]+@[\w.-]+\.\w{2,}/g)]
        .map((m) => m[0])
      return emails.map((email) => ({ customerId, company_name: company, email }))
    }

    return rows
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((c) => c.innerText.trim())
        const text  = row.innerText.trim()
        const email = (text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/) || [])[0] ?? null
        const phone = (text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/) || [])[0] ?? null
        const name  = cells[0] ?? null
        const parts = name?.split(' ') ?? []
        return {
          customerId,
          company_name: company,
          full_name:    name,
          first_name:   parts[0] ?? null,
          last_name:    parts.slice(1).join(' ') || null,
          title:        cells[1] ?? null,
          email,
          phone,
          is_primary:   /primary|main/i.test(text),
        }
      })
      .filter((c) => c.email || c.phone || c.full_name)
  }

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

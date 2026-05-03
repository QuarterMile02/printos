// ShopVOX auto-inject — paste into DevTools console on a customer page.
//
// Reads localStorage.svx_queue (populated by shopvox-extract-contacts.js Phase 1),
// visits each customer page, expands the Contacts section, scrapes all contacts,
// then advances to the next customer.
//
// STORAGE KEYS (must match across all svx scripts):
//   svx_queue          — array of customer UUIDs (set by Phase 1, read-only here)
//   svx_contacts       — accumulated contact objects
//   svx_progress       — { index: N } current position in queue
//   svx_scraper_active — '1' while scraper is running
//
// USAGE
//   1. Run shopvox-extract-contacts.js Phase 1 first to populate svx_queue
//   2. Navigate to https://express.shopvox.com/customers
//   3. Paste this script → Enter
//
// ABORT:   localStorage.removeItem('svx_progress'); localStorage.removeItem('svx_scraper_active'); reload
// RESUME:  paste script again — picks up from saved index
// CHECK:   JSON.parse(localStorage.getItem('svx_contacts') || '[]').length

;(async function svxAutoInject() {
  const DELAY = (ms) => new Promise((r) => setTimeout(r, ms))

  // ── Storage keys ─────────────────────────────────────────────────────────────
  const LS_QUEUE    = 'svx_queue'
  const LS_CONTACTS = 'svx_contacts'
  const LS_PROGRESS = 'svx_progress'
  const LS_ACTIVE   = 'svx_scraper_active'

  function log(msg, style = 'color:#06c;font-weight:bold') {
    console.log('%c' + msg, style)
  }
  function warn(msg) { console.warn('[svx-inject] ' + msg) }

  // ── Persistent save helpers ───────────────────────────────────────────────────

  function saveContacts(contacts) {
    try {
      localStorage.setItem(LS_CONTACTS, JSON.stringify(contacts))
      console.log(`[svx-inject] svx_contacts saved — ${contacts.length} total`)
    } catch (e) {
      console.error('[svx-inject] FAILED to save svx_contacts:', e.message, e)
    }
  }

  function saveProgress(index) {
    try {
      localStorage.setItem(LS_PROGRESS, JSON.stringify({ index }))
      console.log(`[svx-inject] svx_progress saved — index ${index}`)
    } catch (e) {
      console.error('[svx-inject] FAILED to save svx_progress:', e.message, e)
    }
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }

  // ── Show All (Contacts only) ──────────────────────────────────────────────────
  //
  // Two "Show All" buttons exist on customer pages — one for Contacts, one for
  // Addresses. Find by span text, walk up to button, then verify the nearest
  // section ancestor contains "Contacts" before clicking.

  function clickShowAllContacts() {
    const showAllSpan = [...document.querySelectorAll('span')]
      .find((s) => s.textContent.trim() === 'Show All')

    const showAllBtn = showAllSpan?.closest('button')

    // Guard: only click if this "Show All" belongs to the Contacts section
    const section = showAllSpan?.closest('section, div[class*="Contact"], div')
    if (showAllSpan && showAllBtn && section?.textContent.includes('Contacts')) {
      showAllBtn.click()
      return true   // clicked — caller should wait before scraping
    }

    return false    // not found or wrong section — proceed immediately
  }

  // ── Contact extraction ────────────────────────────────────────────────────────

  function extractContacts(customerId) {
    const company = (
      document.querySelector('h1, [data-testid="customer-name"], .customer-name')
        ?.textContent ?? ''
    ).trim()

    const contactSelectors = [
      '[data-testid="contact-row"]',
      '.contact-row',
      '[data-section="contacts"] tr',
      '#contacts-section tr',
      'table[aria-label*="contact" i] tr',
    ]
    let rows = []
    for (const sel of contactSelectors) {
      rows = Array.from(document.querySelectorAll(sel))
      if (rows.length > 0) break
    }

    if (rows.length === 0) {
      const emails = [
        ...document.body.innerText.matchAll(/[\w.+-]+@[\w.-]+\.\w{2,}/g),
      ].map((m) => m[0])
      return emails.map((email) => ({ customerId, company_name: company, email }))
    }

    return rows
      .map((row) => {
        const cells  = Array.from(row.querySelectorAll('td')).map((c) => c.innerText.trim())
        const text   = row.innerText.trim()
        const email  = (text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/) || [])[0] ?? null
        const phone  = (text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/) || [])[0] ?? null
        const name   = cells[0] ?? null
        const parts  = name?.split(' ') ?? []
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

  // ── Navigation ────────────────────────────────────────────────────────────────

  async function navigateTo(uuid) {
    const url = `${window.location.origin}/customers/${uuid}`
    history.pushState(null, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))

    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      if (
        window.location.href.includes(uuid) &&
        document.querySelector('h1, [data-testid="customer-name"]')
      ) return true
      await DELAY(400)
    }
    return false
  }

  // ── Main loop ─────────────────────────────────────────────────────────────────

  const queue = JSON.parse(localStorage.getItem(LS_QUEUE) || 'null')
  if (!queue || queue.length === 0) {
    warn('svx_queue is empty — run shopvox-extract-contacts.js Phase 1 first')
    return
  }

  // Load existing progress
  const savedProgress = JSON.parse(localStorage.getItem(LS_PROGRESS) || 'null')
  let index    = savedProgress?.index ?? 0
  let contacts = JSON.parse(localStorage.getItem(LS_CONTACTS) || '[]')

  if (index > 0) {
    log(`▶ Resuming from customer ${index + 1}/${queue.length} (${contacts.length} contacts saved so far)`)
  }

  // Mark scraper as active
  localStorage.setItem(LS_ACTIVE, '1')

  while (index < queue.length) {
    const uuid = queue[index]
    log(`[${index + 1}/${queue.length}] ${uuid}`, 'color:#888')

    const ok = await navigateTo(uuid)
    if (!ok) {
      warn('  SPA nav timed out — falling back to full reload')
      saveProgress(index)
      localStorage.setItem(LS_ACTIVE, '1')
      window.location.href = `${window.location.origin}/customers/${uuid}`
      return
    }

    await DELAY(600)

    const clicked = clickShowAllContacts()
    if (clicked) {
      await DELAY(1500)
    }

    await DELAY(200)
    const newContacts = extractContacts(uuid)
    contacts.push(...newContacts)
    if (newContacts.length) log(`  ✓ ${newContacts.length} contact(s) — ${contacts.length} total`)

    index++
    saveProgress(index)
    saveContacts(contacts)

    await DELAY(300)
  }

  localStorage.removeItem(LS_ACTIVE)

  log(
    `✓ Done — ${contacts.length} contacts across ${queue.length} customers`,
    'color:#0a7;font-weight:bold;font-size:14px',
  )
  downloadJson({ contacts }, `shopvox-contacts-${new Date().toISOString().slice(0, 10)}.json`)
})()

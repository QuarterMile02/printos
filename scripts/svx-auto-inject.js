// ShopVOX auto-inject — paste into DevTools console on a customer page.
//
// Reads localStorage.svx_queue (populated by shopvox-extract-contacts.js Phase 1),
// visits each customer page, expands the Contacts section, scrapes all contacts,
// then advances to the next customer.
//
// USAGE
//   1. Run shopvox-extract-contacts.js Phase 1 first to populate svx_queue
//   2. Navigate to https://express.shopvox.com/customers
//   3. Paste this script → Enter
//
// ABORT:   localStorage.removeItem('svx_inject'); reload
// RESUME:  paste script again — picks up from saved index

;(async function svxAutoInject() {
  const DELAY  = (ms) => new Promise((r) => setTimeout(r, ms))
  const LS_Q   = 'svx_queue'
  const LS_INJ = 'svx_inject'   // { index, results }

  function log(msg, style = 'color:#06c;font-weight:bold') {
    console.log('%c' + msg, style)
  }
  function warn(msg) { console.warn('[svx-inject] ' + msg) }

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

    // Collect all contact cards / rows rendered after "Show All" was clicked
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
      // Fallback: scrape email addresses visible in page text
      const emails = [
        ...document.body.innerText.matchAll(/[\w.+-]+@[\w.-]+\.\w{2,}/g),
      ].map((m) => m[0])
      return emails.map((email) => ({ customerId, company_name: company, email }))
    }

    return rows
      .map((row) => {
        const cells   = Array.from(row.querySelectorAll('td')).map((c) => c.innerText.trim())
        const text    = row.innerText.trim()
        const email   = (text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/) || [])[0] ?? null
        const phone   = (text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/) || [])[0] ?? null
        const name    = cells[0] ?? null
        const parts   = name?.split(' ') ?? []
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

    // Wait for the page to show the customer UUID in the URL and some content
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

  const queue = JSON.parse(localStorage.getItem(LS_Q) || 'null')
  if (!queue || queue.length === 0) {
    warn('svx_queue is empty — run shopvox-extract-contacts.js Phase 1 first')
    return
  }

  let state = JSON.parse(localStorage.getItem(LS_INJ) || 'null')
  if (!state) {
    state = { index: 0, results: [] }
  } else {
    log(`▶ Resuming from ${state.index}/${queue.length} (${state.results.length} contacts so far)`)
  }

  while (state.index < queue.length) {
    const uuid = queue[state.index]
    log(`[${state.index + 1}/${queue.length}] ${uuid}`, 'color:#888')

    const ok = await navigateTo(uuid)
    if (!ok) {
      warn(`  SPA nav timed out — falling back to full reload`)
      localStorage.setItem(LS_INJ, JSON.stringify(state))
      window.location.href = `${window.location.origin}/customers/${uuid}`
      return
    }

    await DELAY(600)   // let React settle before looking for Show All

    // processAndAdvance is the continuation after the optional Show All click
    async function processAndAdvance() {
      await DELAY(200)
      const contacts = extractContacts(uuid)
      state.results.push(...contacts)
      if (contacts.length) log(`  ✓ ${contacts.length} contact(s)`)
      state.index++
      localStorage.setItem(LS_INJ, JSON.stringify(state))
    }

    // Click "Show All" only for the Contacts section, then wait for render
    const clicked = clickShowAllContacts()
    if (clicked) {
      await DELAY(1500)
    }
    await processAndAdvance()

    await DELAY(300)
  }

  log(
    `✓ Done — ${state.results.length} contacts across ${queue.length} customers`,
    'color:#0a7;font-weight:bold;font-size:14px',
  )
  downloadJson({ contacts: state.results }, `shopvox-contacts-${new Date().toISOString().slice(0, 10)}.json`)
  localStorage.removeItem(LS_INJ)
})()

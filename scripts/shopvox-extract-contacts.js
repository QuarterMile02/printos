// ShopVOX contacts extractor — paste into DevTools console on the customer list page.
//
// CONFIRMED PATTERN (ShopVOX express.shopvox.com):
//   - Customer list shows 50 rows, "Load 50 more" button at bottom
//   - Each click fires GET /companies?page=N&perPage=50
//   - ~91 clicks needed for 4,555 customers (~3 minutes)
//
// USAGE
//   1. Go to https://express.shopvox.com/customers
//   2. Open DevTools → Console → paste this file → Enter
//   3. Phase 1 auto-clicks "Load more" ~91 times, queues all IDs in localStorage
//   4. Verify: JSON.parse(localStorage.getItem('svx_queue')).length  // expect ~4555
//   5. Phase 2 visits each customer page and extracts contacts, downloads JSON
//
// ABORT:   localStorage.removeItem('svx_queue'); localStorage.removeItem('svx_cx')
// RESUME:  paste script again — resumes from last saved position

;(async function svxContacts() {
  const DELAY   = (ms) => new Promise((r) => setTimeout(r, ms))
  const LS_Q    = 'svx_queue'   // array of customer UUIDs
  const LS_CX   = 'svx_cx'     // scrape progress { index, results }
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

  // ── Utilities ────────────────────────────────────────────────────────────────

  function log(msg, style = 'color:#06c;font-weight:bold') {
    console.log('%c' + msg, style)
  }
  function warn(msg) { console.warn('[svx] ' + msg) }
  function err(msg)  { console.error('[svx] ' + msg) }

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

  // ── Phase 1: collect all customer IDs ────────────────────────────────────────

  async function collectAllCustomerIds() {
    log('▶ Phase 1 — clicking "Load more" until all customers are in the DOM (~91 clicks)')
    return clickLoadMoreUntilDone()
  }

  // Confirmed pattern: ShopVOX renders 50 customers at a time behind a
  // "Load 50 more" button. Each click fires /companies?page=N&perPage=50.
  // ~91 clicks needed for 4,555 customers. ~3 minutes total.
  async function clickLoadMoreUntilDone() {
    const UUID_HREF = /\/customers\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i

    function getLoadMoreBtn() {
      return [...document.querySelectorAll('button')].find((b) => {
        const t = b.textContent.toLowerCase()
        return t.includes('load') && t.includes('more') && b.offsetParent !== null
      }) ?? null
    }

    function countIds() {
      return new Set(
        [...document.querySelectorAll('a[href*="/customers/"]')]
          .map((a) => a.href.match(UUID_HREF)?.[1])
          .filter(Boolean),
      ).size
    }

    const MAX_CLICKS  = 200   // hard ceiling (200 × 50 = 10,000 customers)
    let   staleRounds = 0
    let   lastCount   = countIds()

    for (let i = 0; i < MAX_CLICKS; i++) {
      const btn = getLoadMoreBtn()

      if (!btn) {
        log(`  No "Load more" button — list fully loaded after ${i} click(s)`)
        break
      }

      btn.scrollIntoView({ block: 'center' })
      await DELAY(300)
      btn.click()
      await DELAY(1500)   // wait for /companies API response + React render

      const current = countIds()
      log(`  Click ${i + 1}: ${current} customers in DOM`)

      if (current === lastCount) {
        staleRounds++
        if (staleRounds >= 2) {
          log('  Count stable for 2 rounds — treating as fully loaded')
          break
        }
      } else {
        staleRounds = 0
        lastCount   = current
      }
    }

    // Final harvest: all UUIDs from rendered <a> hrefs
    const allIds = [...new Set(
      [...document.querySelectorAll('a[href*="/customers/"]')]
        .map((a) => a.href.match(UUID_HREF)?.[1])
        .filter(Boolean),
    )]

    return allIds
  }

  // ── Phase 2: scrape contacts from each customer page ─────────────────────────

  async function scrapeContacts(queue) {
    let state = JSON.parse(localStorage.getItem(LS_CX) || 'null')
    if (!state) {
      state = { index: 0, results: [] }
    } else {
      log(`▶ Resuming from customer ${state.index + 1}/${queue.length}`)
    }

    const BASE = window.location.origin

    while (state.index < queue.length) {
      const uuid = queue[state.index]
      const url  = `${BASE}/customers/${uuid}`

      log(`[${state.index + 1}/${queue.length}] ${uuid}`, 'color:#888')

      // SPA navigate
      let ok = false
      try {
        history.pushState(null, '', url)
        window.dispatchEvent(new PopStateEvent('popstate'))
        ok = await waitForCustomerPage(uuid, 10000)
      } catch (e) {
        warn(`SPA nav failed: ${e.message}`)
      }

      if (!ok) {
        warn(`  SPA nav timed out — full reload fallback. Paste script again on next page.`)
        localStorage.setItem(LS_CX, JSON.stringify(state))
        window.location.href = url
        return
      }

      try {
        const contacts = extractContactsFromPage(uuid)
        state.results.push(...contacts)
        if (contacts.length) log(`  ✓ ${contacts.length} contact(s)`)
      } catch (e) {
        err(`  extraction failed: ${e.message}`)
      }

      state.index++
      localStorage.setItem(LS_CX, JSON.stringify(state))
      await DELAY(300)
    }

    log(`✓ Done — ${state.results.length} contacts across ${queue.length} customers`, 'color:#0a7;font-weight:bold;font-size:14px')
    downloadJson({ contacts: state.results }, `shopvox-contacts-${new Date().toISOString().slice(0,10)}.json`)
    localStorage.removeItem(LS_CX)
    localStorage.removeItem(LS_Q)
  }

  async function waitForCustomerPage(uuid, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (window.location.href.includes(uuid) && document.querySelector('[data-testid="customer-detail"], .customer-detail, #customer-detail, h1')) {
        return true
      }
      await DELAY(400)
    }
    return false
  }

  function extractContactsFromPage(customerId) {
    // Company name from page header
    const company = (document.querySelector('h1, [data-testid="customer-name"]')?.textContent ?? '').trim()

    // Contact rows — try multiple selector patterns ShopVOX uses
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
      // Fallback: look for email patterns in the page text
      const emails = [...document.body.innerText.matchAll(/[\w.+-]+@[\w.-]+\.\w{2,}/g)].map((m) => m[0])
      if (emails.length === 0) return []
      return emails.map((email) => ({ customerId, company_name: company, email }))
    }

    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td')).map((c) => c.innerText.trim())
      const text  = row.innerText.trim()
      const email = (text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/) || [])[0] ?? null
      const phone = (text.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/) || [])[0] ?? null
      return {
        customerId,
        company_name: company,
        full_name:    cells[0] ?? null,
        first_name:   cells[0]?.split(' ')[0] ?? null,
        last_name:    cells[0]?.split(' ').slice(1).join(' ') || null,
        title:        cells[1] ?? null,
        email,
        phone,
        is_primary:   /primary|main/i.test(text),
      }
    }).filter((c) => c.email || c.phone || c.full_name)
  }

  // ── Entry point ──────────────────────────────────────────────────────────────

  // If scrape already in progress, continue it
  const existingProgress = JSON.parse(localStorage.getItem(LS_CX) || 'null')
  let queue = JSON.parse(localStorage.getItem(LS_Q) || 'null')

  if (existingProgress && queue) {
    log(`▶ Resuming scrape: ${existingProgress.index}/${queue.length} done, ${existingProgress.results.length} contacts so far`)
    await scrapeContacts(queue)
    return
  }

  if (!queue) {
    log('▶ Phase 1 — collecting all customer IDs')
    const collected = await collectAllCustomerIds()

    // ── Safety check ────────────────────────────────────────────────────────
    if (!collected || collected.length < 1000) {
      err(
        `ABORT: only ${collected?.length ?? 0} customer IDs found (expected ~4555). ` +
        `Virtual scroll or API intercept did not capture the full list. ` +
        `Check that you are on the customer list page and it has loaded at least one row.`
      )
      throw new Error(`collectAllCustomerIds returned ${collected?.length ?? 0} IDs — below minimum threshold of 1000`)
    }

    queue = collected
    localStorage.setItem(LS_Q, JSON.stringify(queue))

    log(
      `✓ Phase 1 complete — ${queue.length} customer IDs queued.\n` +
      `  Verify: JSON.parse(localStorage.getItem('svx_queue')).length\n` +
      `  Then paste script again to start scraping contacts.`,
      'color:#0a7;font-weight:bold;font-size:13px'
    )

    // Pause here so the user can verify the queue length before proceeding
    return
  }

  // Queue exists, no progress — start scraping
  log(`▶ Phase 2 — scraping ${queue.length} customers for contacts`)
  await scrapeContacts(queue)

})()

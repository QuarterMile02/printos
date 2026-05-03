// ShopVOX contacts extractor — paste into DevTools console on the customer list page.
//
// USAGE
//   1. Go to https://express.shopvox.com/customers  (or /accounts — whatever the list URL is)
//   2. Open DevTools → Console → paste this file → Enter
//   3. Phase 1 collects all ~4,555 customer IDs into localStorage.svx_queue
//   4. Verify: JSON.parse(localStorage.getItem('svx_queue')).length
//   5. Phase 2 iterates the queue, visits each customer, downloads contacts JSON
//
// ABORT:   localStorage.removeItem('svx_queue'); localStorage.removeItem('svx_cx')
// RESUME:  paste script again — it picks up from where it left off

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
    // Strategy 1: intercept the live XHR/fetch request, extract pagination, replay all pages.
    log('▶ Strategy 1 — API intercept')
    const ids = await tryApiIntercept()
    if (ids && ids.length >= 100) {
      log(`  ✓ API intercept found ${ids.length} IDs`)
      return ids
    }
    warn('  Strategy 1 found < 100 IDs — trying virtual scroll')

    // Strategy 2: scrollIntoView on last visible row until no new rows appear.
    log('▶ Strategy 2 — virtual scroll (scrollIntoView on last row)')
    const scrollIds = await tryVirtualScroll()
    if (scrollIds && scrollIds.length >= 100) {
      log(`  ✓ Scroll collected ${scrollIds.length} IDs`)
      return scrollIds
    }
    warn(`  Strategy 2 only found ${scrollIds?.length ?? 0} IDs`)

    return scrollIds ?? []
  }

  // ── Strategy 1: API intercept ────────────────────────────────────────────────

  async function tryApiIntercept() {
    return new Promise((resolve) => {
      const capturedRequests = []
      let resolved = false

      const origFetch = window.fetch
      const origXhrOpen = XMLHttpRequest.prototype.open
      const origXhrSend = XMLHttpRequest.prototype.send

      function restore() {
        window.fetch = origFetch
        XMLHttpRequest.prototype.open = origXhrOpen
        XMLHttpRequest.prototype.send = origXhrSend
      }

      // Intercept fetch
      window.fetch = async function (url, opts) {
        const urlStr = typeof url === 'string' ? url : url?.url ?? ''
        if (!resolved && /customer|account|contact/i.test(urlStr) && !/favicon|css|png/i.test(urlStr)) {
          const result = origFetch.apply(this, arguments)
          result.then(async (res) => {
            try {
              const clone = res.clone()
              const body  = await clone.json()
              capturedRequests.push({ url: urlStr, opts, body })
            } catch {}
          })
          return result
        }
        return origFetch.apply(this, arguments)
      }

      // Intercept XHR
      const xhrInstances = []
      XMLHttpRequest.prototype.open = function (method, url) {
        if (!resolved && /customer|account|contact/i.test(url) && !/favicon|css|png/i.test(url)) {
          this._svxUrl = url
          this._svxMethod = method
          xhrInstances.push(this)
        }
        return origXhrOpen.apply(this, arguments)
      }
      XMLHttpRequest.prototype.send = function (body) {
        if (this._svxUrl) {
          this.addEventListener('load', function () {
            try {
              capturedRequests.push({
                url: this._svxUrl,
                method: this._svxMethod,
                body: JSON.parse(this.responseText),
              })
            } catch {}
          })
        }
        return origXhrSend.apply(this, arguments)
      }

      // Trigger a scroll to fire the virtual list's data-load API
      setTimeout(() => {
        const scrollable = findScrollContainer()
        if (scrollable) {
          scrollable.scrollTo({ top: scrollable.scrollHeight, behavior: 'smooth' })
        } else {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
        }
      }, 300)

      // Give it 4 seconds to capture at least one request
      setTimeout(async () => {
        restore()
        resolved = true

        if (capturedRequests.length === 0) {
          resolve(null)
          return
        }

        log(`  Captured ${capturedRequests.length} API request(s)`)

        // Find the most likely customer-list request (has an array of records)
        const listReq = capturedRequests.find((r) => {
          const data = r.body?.data ?? r.body?.results ?? r.body?.customers ?? r.body?.accounts ?? r.body
          return Array.isArray(data) && data.length > 0
        })

        if (!listReq) {
          warn('  No list-format response found in captured requests')
          resolve(null)
          return
        }

        log(`  Using: ${listReq.url}`)

        // Paginate to collect all IDs
        try {
          const allIds = await replayWithPagination(listReq, origFetch)
          resolve(allIds)
        } catch (e) {
          warn('  Pagination replay failed: ' + e.message)
          resolve(null)
        }
      }, 4000)
    })
  }

  async function replayWithPagination(req, origFetch) {
    const url       = new URL(req.url, window.location.origin)
    const body      = req.body
    const dataArray = body?.data ?? body?.results ?? body?.customers ?? body?.accounts ?? body

    if (!Array.isArray(dataArray) || dataArray.length === 0) return []

    // Detect total count
    const total = body?.meta?.total ?? body?.total ?? body?.count ?? body?.pagination?.total_records ?? null
    const pageSize = dataArray.length

    // Detect pagination style: page-based vs offset-based
    const hasPage   = url.searchParams.has('page')
    const hasOffset = url.searchParams.has('offset')
    const hasLimit  = url.searchParams.has('limit')
    const hasPer    = url.searchParams.has('per_page')

    log(`  Page size: ${pageSize}, Total: ${total ?? 'unknown'}, Style: ${hasPage ? 'page' : 'offset'}`)

    const extractIds = (records) =>
      records
        .map((r) => r.id ?? r.uuid ?? r.customerId ?? r.customer_id ?? extractUuidFromUrl(r.url ?? r.href ?? ''))
        .filter((id) => id && UUID_RE.test(id))

    const allIds = new Set(extractIds(dataArray))
    const maxPages = total ? Math.ceil(total / pageSize) : 200 // cap at 200 pages as safety

    if (hasPage) {
      const currentPage = parseInt(url.searchParams.get('page')) || 1
      log(`  Fetching pages ${currentPage + 1}–${maxPages}…`)
      for (let page = currentPage + 1; page <= maxPages; page++) {
        url.searchParams.set('page', page)
        try {
          const res  = await origFetch(url.toString(), { headers: { 'Accept': 'application/json' }, credentials: 'include' })
          const data = await res.json()
          const arr  = data?.data ?? data?.results ?? data?.customers ?? data?.accounts ?? data
          if (!Array.isArray(arr) || arr.length === 0) break
          extractIds(arr).forEach((id) => allIds.add(id))
          if (page % 10 === 0) log(`  …page ${page}/${maxPages}, collected ${allIds.size} so far`)
        } catch (e) {
          warn(`  Page ${page} fetch failed: ${e.message}`)
          break
        }
        await DELAY(150)
      }
    } else if (hasOffset || hasLimit) {
      const limit   = parseInt(url.searchParams.get('limit') || url.searchParams.get('per_page')) || pageSize
      let   offset  = parseInt(url.searchParams.get('offset') || '0') || 0
      const maxTotal = total ?? 10000
      log(`  Fetching offsets from ${offset + limit} to ${maxTotal} (step ${limit})…`)
      for (offset = offset + limit; offset < maxTotal; offset += limit) {
        if (hasOffset)  url.searchParams.set('offset', offset)
        if (hasPer)     url.searchParams.set('per_page', limit)
        if (hasLimit)   url.searchParams.set('limit', limit)
        try {
          const res  = await origFetch(url.toString(), { headers: { 'Accept': 'application/json' }, credentials: 'include' })
          const data = await res.json()
          const arr  = data?.data ?? data?.results ?? data?.customers ?? data?.accounts ?? data
          if (!Array.isArray(arr) || arr.length === 0) break
          extractIds(arr).forEach((id) => allIds.add(id))
          if ((offset / limit) % 10 === 0) log(`  …offset ${offset}, collected ${allIds.size} so far`)
        } catch (e) {
          warn(`  Offset ${offset} fetch failed: ${e.message}`)
          break
        }
        await DELAY(150)
      }
    } else {
      // Unknown pagination — just return what we have from the first page
      warn('  Unknown pagination style, returning first-page IDs only')
    }

    return [...allIds]
  }

  function extractUuidFromUrl(str) {
    const m = str.match(UUID_RE)
    return m ? m[0] : null
  }

  // ── Strategy 2: virtual scroll (scrollIntoView on last row) ──────────────────

  async function tryVirtualScroll() {
    const ids    = new Set()
    let   stale  = 0          // consecutive rounds with no new IDs
    const MAX_STALE = 4

    log('  Scrolling list to load all rows…')

    while (stale < MAX_STALE) {
      // Collect IDs from currently-rendered hrefs
      const before = ids.size
      collectVisibleIds(ids)

      // Find the last visible customer row and scrollIntoView it
      const lastRow = findLastRow()
      if (lastRow) {
        lastRow.scrollIntoView({ behavior: 'smooth', block: 'end' })
      } else {
        const container = findScrollContainer()
        if (container) container.scrollTop = container.scrollHeight
        else window.scrollTo({ top: document.body.scrollHeight })
      }

      await DELAY(800) // wait for virtual scroll to render new batch

      const after = ids.size
      collectVisibleIds(ids)

      if (ids.size > before) {
        stale = 0
        if (ids.size % 200 < 50) log(`  …collected ${ids.size} IDs`)
      } else {
        stale++
        log(`  No new IDs (stale round ${stale}/${MAX_STALE})`)
      }
    }

    return [...ids]
  }

  function collectVisibleIds(idSet) {
    // Grab UUIDs from all <a> hrefs that look like customer links
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') ?? ''
      if (/customer|account/i.test(href)) {
        const m = href.match(UUID_RE)
        if (m) idSet.add(m[0])
      }
    })
    // Also scan data-id / data-customer-id attributes
    document.querySelectorAll('[data-id],[data-customer-id],[data-uuid]').forEach((el) => {
      const val = el.dataset.id ?? el.dataset.customerId ?? el.dataset.uuid
      if (val && UUID_RE.test(val)) idSet.add(val)
    })
  }

  function findLastRow() {
    // Try common virtual-list row selectors in order of specificity
    const selectors = [
      'tr[data-customer-id]',
      'tr[data-id]',
      '.customer-row',
      '.account-row',
      '[role="row"]',
      'tbody tr',
    ]
    for (const sel of selectors) {
      const rows = document.querySelectorAll(sel)
      if (rows.length > 0) return rows[rows.length - 1]
    }
    return null
  }

  function findScrollContainer() {
    // Walk up from a table/list looking for an overflow:auto/scroll container
    const candidates = [
      document.querySelector('[data-virtual-scroll]'),
      document.querySelector('[data-testid="virtual-list"]'),
      document.querySelector('.virtual-list'),
      document.querySelector('.ag-body-viewport'),   // AG Grid
      document.querySelector('.infinite-scroll'),
      ...Array.from(document.querySelectorAll('*')).filter((el) => {
        const s = getComputedStyle(el)
        return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > window.innerHeight
      }).slice(0, 3),
    ]
    return candidates.find(Boolean) ?? null
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

// Shared, read-only REST client for api.shopvox.com — rate limiting, 429/5xx
// backoff, and the token lifecycle documented in scripts/api-probe/_findings.md
// §5. Used by scripts/shopvox-capture.mjs. GET only — this module has no
// POST/PUT/PATCH/DELETE call anywhere in it. The one POST the app makes
// (authentication/refresh_token) is triggered by the SPA itself when we
// navigate a page — we never construct that request ourselves.
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

const API_HEADERS = { accept: 'application/json, text/plain, */*', 'x-shopvox-client': 'web' }
const REFRESH_INTERVAL_MS = 15 * 60 * 1000 // proactive refresh well under the ~30min app_token TTL
const BACKOFF_START_MS = 1000
const BACKOFF_PAUSE_THRESHOLD_MS = 60000 // if the NEXT backoff would exceed this, pause the run instead of sleeping that long inline
const PAUSE_RECHECK_MS = 60000

export function makeAuthLog(outDir) {
  const logPath = resolve(outDir, '_auth_log.jsonl')
  return (event) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event })
    console.log(`  [auth] ${line}`)
    try { appendFileSync(logPath, line + '\n') } catch { /* best-effort */ }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function makeApiClient({ context, page, rps, authLog }) {
  const minGapMs = 1000 / Math.max(rps, 0.1)
  let lastRequestAt = 0
  let lastRefreshAt = Date.now() // launchBrowser+ensureLoggedInLazy already navigated once — token is fresh at start

  async function refreshToken(reason) {
    authLog({ event: 'refresh_attempt', reason })
    // A plain navigation is enough to make the SPA's own bootstrap logic
    // fire POST /edge/authentication/refresh_token using shopvox_refresh_token
    // — confirmed live in the api-probe investigation. We only ever issue
    // the GET navigation; the app makes that POST itself.
    await page.goto('https://express.shopvox.com/transactions/quotes', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await sleep(2000)
    const cookies = await context.cookies()
    const tok = cookies.find((c) => c.name === 'shopvox_app_token')
    lastRefreshAt = Date.now()
    if (tok) {
      authLog({ event: 'refresh_ok', tokenExpiresAt: new Date(tok.expires * 1000).toISOString() })
      return true
    }
    authLog({ event: 'refresh_failed', note: 'shopvox_app_token still absent after navigation — refresh_token itself is likely expired (past its ~24h TTL)' })
    return false
  }

  async function waitForManualLogin() {
    console.error('\n' + '='.repeat(70))
    console.error('⚠️  SESSION EXPIRED — shopvox_refresh_token has aged out (~24h TTL).')
    console.error('    Please log in again in the open Chromium browser window.')
    console.error('    The run is PAUSED, not aborted — your queue checkpoint is intact.')
    console.error('    It will resume automatically once a request succeeds again.')
    console.error('='.repeat(70) + '\n')
    authLog({ event: 'paused_for_manual_login' })
    for (;;) {
      await sleep(PAUSE_RECHECK_MS)
      const ok = await refreshToken('manual_login_recheck')
      if (ok) {
        // Confirm with a real API call, not just cookie presence. This
        // health-check ping does NOT go through pacedRequest() (deliberate —
        // it must work even while pacedRequest() itself is the thing
        // stalled), so it disposes its own response directly rather than
        // inheriting pacedRequest()'s disposal (2026-08-26 — see that
        // function's own comment for why every APIResponse in this file
        // gets disposed now, not just the ones on the hot path).
        const resp = await context.request.get('https://api.shopvox.com/edge/transactions/quotes?page=1&perPage=1', { headers: API_HEADERS }).catch(() => null)
        const loginRestored = resp && resp.status() === 200
        if (resp) { try { await resp.dispose() } catch {} }
        if (loginRestored) {
          console.log('✓ Session restored — resuming.')
          authLog({ event: 'resumed_after_manual_login' })
          return
        }
      }
      console.error(`  still waiting — will re-check in ${PAUSE_RECHECK_MS / 1000}s (log in when ready)`)
    }
  }

  async function maybeProactiveRefresh() {
    if (Date.now() - lastRefreshAt > REFRESH_INTERVAL_MS) {
      await refreshToken('proactive_15min')
    }
  }

  async function pauseForBackoff(attemptInfo) {
    console.error(`\n⚠️  PAUSING — backoff would exceed ${BACKOFF_PAUSE_THRESHOLD_MS / 1000}s (${JSON.stringify(attemptInfo)}). Checkpoint stays intact; re-checking every ${PAUSE_RECHECK_MS / 1000}s rather than hammering the API.`)
    authLog({ event: 'paused_for_backoff', ...attemptInfo })
    for (;;) {
      await sleep(PAUSE_RECHECK_MS)
      // Same reasoning as waitForManualLogin()'s ping — outside pacedRequest()
      // on purpose, disposed directly.
      const resp = await context.request.get('https://api.shopvox.com/edge/transactions/quotes?page=1&perPage=1', { headers: API_HEADERS }).catch(() => null)
      const responsive = resp && resp.status() === 200
      const lastStatus = resp ? resp.status() : null
      if (resp) { try { await resp.dispose() } catch {} }
      if (responsive) { console.log('✓ API responsive again — resuming.'); authLog({ event: 'resumed_after_backoff_pause' }); return }
      console.error(`  still ${lastStatus ?? 'unreachable'} — re-checking in ${PAUSE_RECHECK_MS / 1000}s`)
    }
  }

  // Core paced/backed-off/token-aware GET loop, shared by get() and
  // getBinary() so EVERY request against api.shopvox.com — JSON or binary —
  // goes through the same rate limiter, 401-refresh, and 429/5xx backoff
  // logic. Takes a `readBody(resp)` callback rather than returning the raw
  // Playwright response, so this function alone owns every APIResponse's
  // full lifecycle — request, read, dispose — for both callers.
  //
  // DISPOSAL (2026-08-26 — root cause of the 4th capture death, a heap OOM
  // after 29h/41,766 records): Playwright's APIRequestContext tracks every
  // response it hands back until `.dispose()` is called; neither `get()` nor
  // `getBinary()` ever called it before this fix, on ANY response — not the
  // terminal one whose body actually gets read, and not the RETRIED ones
  // (a 401 or a 429/5xx response was obtained, inspected via `.status()`,
  // and then simply dropped by looping again — never disposed either). Over
  // a single 29-hour run issuing several hundred thousand requests (41,766
  // records × ~10 endpoints each, plus retries/pagination), that is the one
  // thing in this whole pipeline that scales with requests processed rather
  // than queue size — matching a crash at hour 29, not at startup, with
  // nothing in the application's own data structures big enough to explain
  // it (see SHOPVOX_MIGRATION_NOTES.md, "capture death #4"). Every response
  // obtained anywhere in this loop — retried or terminal — is now disposed
  // before the loop either continues or returns, in a `finally` for the
  // terminal case so a throw from `readBody` still releases it.
  async function pacedRequest(url, extraHeaders, readBody) {
    await maybeProactiveRefresh()
    let backoff = BACKOFF_START_MS
    let attempt = 0
    for (;;) {
      attempt++
      const gap = minGapMs - (Date.now() - lastRequestAt)
      if (gap > 0) await sleep(gap)
      lastRequestAt = Date.now()

      let resp
      try {
        resp = await context.request.get(url, { headers: { ...API_HEADERS, ...extraHeaders } })
      } catch (e) {
        // network-level failure — treat like a 5xx for backoff purposes
        resp = null
      }
      const status = resp ? resp.status() : 0

      if (status === 401) {
        if (resp) { try { await resp.dispose() } catch {} }
        const refreshed = await refreshToken('401_reactive')
        if (!refreshed) { await waitForManualLogin(); continue }
        continue // retry the same request once refreshed
      }
      if (status === 429 || status === 0 || status >= 500) {
        if (resp) { try { await resp.dispose() } catch {} }
        if (backoff > BACKOFF_PAUSE_THRESHOLD_MS) {
          await pauseForBackoff({ url, status, attempt })
          backoff = BACKOFF_START_MS // reset after a successful pause-recheck cycle
          continue
        }
        console.error(`  ⚠️ ${status || 'network error'} on ${url} — backing off ${backoff}ms (attempt ${attempt})`)
        await sleep(backoff)
        backoff *= 2
        continue
      }

      // Non-retriable status (200, 404, etc). No response object at all
      // (a network-level failure that still fell through to here — shouldn't
      // happen given status would be 0 above, but defensive) — nothing to
      // read or dispose.
      if (!resp) return { status, body: null }
      // Dispose AFTER the body is read, never before — the read is why the
      // response was fetched. The `finally` guarantees disposal even if
      // `readBody` itself throws, so a parse error can never leak a response.
      try {
        const body = await readBody(resp)
        return { status, body }
      } finally {
        try { await resp.dispose() } catch {}
      }
    }
  }

  // GET only. Returns { status, ok, json, text, error }. Never throws for
  // ordinary HTTP-level failures (404 etc — those are just recorded); only
  // throws if the caller's own logic is broken.
  async function get(url) {
    const { status, body: text } = await pacedRequest(url, {}, async (resp) => {
      try { return await resp.text() } catch { return null }
    })
    let json = null
    if (text) { try { json = JSON.parse(text) } catch {} }
    return { status, ok: status >= 200 && status < 300, json, text, url }
  }

  // Binary GET (PDFs etc) — same rate limiter/backoff/token loop as get(),
  // just no JSON parse. Returns { status, ok, buffer, url }.
  async function getBinary(url, accept = 'application/pdf') {
    const { status, body: buffer } = await pacedRequest(url, { accept }, async (resp) => {
      if (resp.status() !== 200) return null
      try { return await resp.body() } catch { return null }
    })
    return { status, ok: status === 200, buffer, url }
  }

  return { get, getBinary }
}

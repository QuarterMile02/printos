// Shared retry-with-backoff for Supabase reads/writes over PostgREST.
//
// Built for the wide ShopVOX->native promotion run (~4,500 customers) where
// transient network blips, 5xx, and 429s are expected to happen many times
// over a long unattended run — same class of problem as the EPERM retry fix
// in shopvox-capture.mjs's flushQueue (retry the transient thing, fail loudly
// on the real thing), applied to Supabase calls instead of a file rename.
//
// Retries: a thrown network-level failure (DNS, socket reset, timeout, fetch
// failure — thrown before any HTTP response came back), HTTP 429 (rate
// limited), and HTTP 5xx (server/gateway errors). Does NOT retry a 4xx
// PostgREST/Postgres error (schema mismatch, constraint violation, bad
// input, auth) — those are real bugs. Retrying them would just burn 5
// attempts arriving at the identical failure while hiding it behind a wall
// of retry noise; they must surface immediately, same as today.
//
// Usage:
//   import { withRetry } from './lib/retry.mjs'
//   const { data, error } = await withRetry(
//     () => sb.from('quotes').select('id').eq('organization_id', ORG),
//     'quotes select'
//   )
//   // same {data, error, status, ...} shape supabase-js normally returns —
//   // every existing call site's own `if (error) throw/exit` handling works
//   // completely unchanged. withRetry only delays *returning* a terminal
//   // (non-retryable, or retries-exhausted) result; it never swallows one.

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000] // 5 retries, ~15.5s total before giving up
const NETWORK_ERROR_PATTERN = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|network|fetch failed|failed to fetch|AbortError|FetchError|other side closed|UND_ERR/i

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// supabase-js/postgrest-js resolves to {data, error, status, statusText, ...}
// even on a PostgREST-level error — `status` is the real HTTP status code.
// Only fall back to sniffing the error message when status isn't a number
// (older client shape, or something upstream of postgrest-js swallowed it).
function isRetryableResult(result) {
  if (!result || !result.error) return false
  const status = result.status
  if (typeof status === 'number') {
    if (status === 429) return true
    if (status >= 500 && status < 600) return true
    if (status >= 400 && status < 500) return false // real schema/constraint/auth error — never retry
  }
  return NETWORK_ERROR_PATTERN.test(result.error.message || '')
}

/**
 * Runs `fn()` (a thunk returning a supabase-js query-builder promise that
 * resolves to {data, error, status, ...}) with retry-with-backoff on
 * transient failures. Returns the same {data, error, ...} shape on a
 * terminal result — never throws for a PostgREST-level error, matching every
 * existing call site's own handling. Only throws if `fn()` itself throws
 * (a network failure with no response at all) on the final attempt.
 *
 * @param {() => Promise<any>} fn
 * @param {string} label — used in the retry warning, e.g. "quotes upsert batch 3"
 */
export async function withRetry(fn, label) {
  let lastThrown = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await fn()
      if (isRetryableResult(result) && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt]
        console.warn(`  [retry] ${label}: ${result.error.message} (status ${result.status ?? 'n/a'}) — attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}, retrying in ${delay}ms`)
        await sleep(delay)
        continue
      }
      return result
    } catch (err) {
      lastThrown = err
      const retryableThrow = NETWORK_ERROR_PATTERN.test(err.message || '')
      if (retryableThrow && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt]
        console.warn(`  [retry] ${label}: ${err.message} (thrown, no response) — attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}, retrying in ${delay}ms`)
        await sleep(delay)
        continue
      }
      throw err // not a network-shaped thrown error, or retries exhausted — fail loudly
    }
  }
  throw lastThrown
}

// Shared pagination helper for reading from Supabase/PostgREST.
//
// CONFIRMED LIVE this matters, more than once: an unpaginated .select()
// silently caps at PostgREST's default max-rows (1000) — no error, no
// warning, just a truncated result that looks like a complete one.
// shopvox_transactions hit this first (1079 real rows, a plain select()
// returned exactly 1000, the missing 79 became NULL transaction_id on every
// dependent line_item/charge) — fixed with an inline fetchAllIds() helper in
// import-api-capture.mjs. It was hit AGAIN, independently, during a
// corruption-check diagnostic in this same migration (a `.limit(3000)` call
// that PostgREST still capped at 1000 server-side, since .limit() on the
// client does not raise the server's own row ceiling) — that second hit is
// exactly why this got pulled out into one shared place instead of staying
// duplicated inline. See scripts/SHOPVOX_MIGRATION_NOTES.md for the full
// quirks table.
//
// Usage:
//   import { fetchAllRows } from './lib/supabase-paginate.mjs'
//   const rows = await fetchAllRows(sb, 'shopvox_transactions', (q) => q.select('shopvox_id, kind').eq('customer_shopvox_id', custId))
//   // rows is the FULL result set, however many thousand rows it takes — never silently truncated at 1000.

import { withRetry } from './retry.mjs'

const PAGE_SIZE = 1000

/**
 * Fetch every row matching a query, paginating past PostgREST's default
 * 1,000-row cap. `buildQuery(sb.from(table))` must return a Supabase query
 * builder with whatever .select()/.eq()/.filter()/.order() you need already
 * applied — do NOT call .range() or .limit() yourself, this helper owns
 * pagination. Throws on the first page that errors (does not silently
 * return a partial result).
 *
 * Each page is retried with backoff (see lib/retry.mjs) on a network
 * failure, 429, or 5xx before the whole fetch gives up — added for the
 * wide ~4,500-customer promotion run, where this is the single most-called
 * read path. A schema/constraint/4xx error still throws immediately, same
 * as before. Retrying per-page (not the whole multi-thousand-row fetch)
 * means a transient blip near the end of a long paginated read doesn't cost
 * re-fetching everything before it.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} table
 * @param {(query: any) => any} buildQuery
 * @returns {Promise<any[]>}
 */
export async function fetchAllRows(sb, table, buildQuery) {
  const out = []
  let from = 0
  for (;;) {
    const { data, error } = await withRetry(
      () => buildQuery(sb.from(table)).range(from, from + PAGE_SIZE - 1),
      `${table} fetch offset ${from}`
    )
    if (error) throw new Error(`fetchAllRows(${table}) failed at offset ${from}: ${error.message}`)
    out.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return out
}

/**
 * Convenience wrapper for the common "just give me every id/shopvox_id for
 * this org" case that import-api-capture.mjs's inline fetchAllIds() used to
 * do on its own. Kept separate from fetchAllRows so call sites that need
 * custom select columns or filters use the general form above instead of
 * fighting this one's fixed shape.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} table
 * @param {string} organizationId
 * @returns {Promise<{id: string, shopvox_id: string}[]>}
 */
export async function fetchAllIdsForOrg(sb, table, organizationId) {
  return fetchAllRows(sb, table, (q) => q.select('id, shopvox_id').eq('organization_id', organizationId))
}

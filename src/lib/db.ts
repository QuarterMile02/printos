import type { PostgrestError } from '@supabase/supabase-js'

// Wraps a Supabase query result and makes the "ignore the error" path an
// explicit, visible choice instead of the silent default. Two production
// incidents in one night came from the same shape: `const { data } = await
// supabase.from(...).insert(...)` — `error` never even destructured, so a
// failed write proceeded as if it had succeeded (a fake-success redirect,
// or a webhook ACKing 200 for a write that never happened).
//
// Default to `dbOrThrow` everywhere. Only reach for `dbBestEffort` when
// you've deliberately decided a failure here shouldn't block the caller —
// it still logs loudly, so failures stay visible in server logs instead of
// vanishing.

export class DbError extends Error {
  cause: PostgrestError
  constructor(cause: PostgrestError) {
    super(cause.message)
    this.name = 'DbError'
    this.cause = cause
  }
}

export async function dbOrThrow<T>(
  query: PromiseLike<{ data: T; error: PostgrestError | null }>,
): Promise<T> {
  const { data, error } = await query
  if (error) throw new DbError(error)
  return data
}

export async function dbBestEffort<T>(
  query: PromiseLike<{ data: T; error: PostgrestError | null }>,
  context: string,
  fallback: T,
): Promise<T> {
  const { data, error } = await query
  if (error) {
    console.error(`[dbBestEffort:${context}] Supabase query failed, continuing with fallback:`, error.message)
    return fallback
  }
  return data
}

// PostgREST truncates any unbounded select at 1000 rows, silently — no
// error, no flag, just fewer rows than actually exist. Confirmed to have
// already produced a wrong count once on this project (materials
// migrate screen). Any query that could plausibly exceed 1000 rows for
// a real org must page through with explicit .range() calls rather than
// trust a single unbounded select — this is the one place that does it,
// so every caller gets the same discipline instead of hand-rolling a
// loop (and potentially getting the off-by-one wrong) at each call site.
const PAGE_SIZE = 1000

export async function dbAllOrThrow<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error) throw new DbError(error)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

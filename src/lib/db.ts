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

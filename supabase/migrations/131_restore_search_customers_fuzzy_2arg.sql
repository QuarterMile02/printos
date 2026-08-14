-- ============================================================
-- Migration 131: Restore search_customers_fuzzy(uuid, text)
-- Applied: NOT YET APPLIED — proposed only, paste into Supabase SQL editor to run
-- ============================================================
--
-- Live-verifying migration 129 turned up a mistake in it: dropping the
-- 3-arg search_customers_fuzzy(uuid, text, integer) overload (migration
-- 097's) left 2-arg calls -- what searchCustomers() in customers/actions.ts
-- actually makes -- resolving to nothing at all (PGRST202, "could not
-- find the function"), even after a schema-cache reload (migration 130).
--
-- What actually happened: migration 129's investigation tested both a
-- 2-arg and a 3-arg call and got identical 13-column results for both,
-- which was read as "two separate, identically-shaped functions coexist,
-- the 3-arg one is just unreachable dead weight." That was wrong -- it's
-- equally consistent with there being only ONE function (097's 3-arg
-- version, p_limit integer DEFAULT 50) the whole time, silently serving
-- 2-arg calls via PostgREST's default-parameter resolution. Dropping it
-- removed the only implementation there was, not a redundant duplicate.
-- (searchCustomers() has a graceful ILIKE fallback for when the RPC
-- errors -- confirmed customer search wasn't hard-broken for users in the
-- meantime, just silently degraded to non-fuzzy substring matching, same
-- as search_vendors_fuzzy's fallback in migration 130's report.)
--
-- Fix: recreate the real, standalone (uuid, text) signature exactly as
-- migration 064 defined it -- the last confirmed-correct version of that
-- exact signature -- so it exists independently again with zero
-- ambiguity (the 3-arg sibling is gone for good, dropped in 129).

CREATE OR REPLACE FUNCTION search_customers_fuzzy(
  p_org_id uuid,
  p_term   text
)
RETURNS TABLE (
  id           uuid,
  first_name   text,
  last_name    text,
  company_name text,
  email        text,
  phone        text,
  city         text,
  state        text,
  status       text,
  terms        text,
  is_active    boolean,
  tags         text[],
  created_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (c.id)
    c.id,
    c.first_name::text,
    c.last_name::text,
    c.company_name::text,
    c.email::text,
    c.phone::text,
    c.city::text,
    c.state::text,
    c.status::text,
    c.terms::text,
    c.is_active,
    c.tags,
    c.created_at
  FROM customers c
  LEFT JOIN customer_contacts cc ON cc.customer_id = c.id
  WHERE c.organization_id = p_org_id
    AND (
      c.company_name             ILIKE '%' || p_term || '%'
      OR (c.first_name || ' ' || c.last_name) ILIKE '%' || p_term || '%'
      OR c.email                 ILIKE '%' || p_term || '%'
      OR c.city                  ILIKE '%' || p_term || '%'
      OR c.phone                 ILIKE '%' || p_term || '%'
      OR cc.full_name            ILIKE '%' || p_term || '%'
      OR (c.company_name IS NOT NULL AND similarity(c.company_name, p_term) > 0.25)
      OR similarity(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''), p_term) > 0.25
      OR regexp_replace(coalesce(c.company_name, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(p_term, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    c.id,
    CASE
      WHEN c.company_name ILIKE '%' || p_term || '%' THEN 0
      WHEN (c.first_name || ' ' || c.last_name) ILIKE '%' || p_term || '%' THEN 1
      WHEN c.email ILIKE '%' || p_term || '%' THEN 2
      ELSE 3
    END
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_customers_fuzzy(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

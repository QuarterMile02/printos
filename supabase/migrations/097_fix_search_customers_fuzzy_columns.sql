-- Migration 097: Re-sync search_customers_fuzzy with current customers schema.
--
-- Migrations 062 and 064 added city, state, terms, tags, and created_at to
-- this function's RETURNS TABLE and SELECT list, but were never applied to the
-- hosted project. The live function therefore returns rows missing those columns,
-- causing the search path on the Customers list to show blank City/State.
--
-- CREATE OR REPLACE is safe to run multiple times.

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

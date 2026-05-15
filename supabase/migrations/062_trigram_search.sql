-- Trigram fuzzy search for customers and vendors.
-- Requires pg_trgm extension — apply manually in Supabase SQL editor first:
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Indexes for trigram matching
CREATE INDEX IF NOT EXISTS idx_customers_company_trgm
  ON customers USING gin(company_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_fullname_trgm
  ON customers USING gin(
    (coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_vendors_name_trgm
  ON vendors USING gin(name gin_trgm_ops);

-- ── Customer fuzzy search function ────────────────────────────────────────────
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
      -- Strategy 1: exact substring (fast)
      c.company_name             ILIKE '%' || p_term || '%'
      OR (c.first_name || ' ' || c.last_name) ILIKE '%' || p_term || '%'
      OR c.email                 ILIKE '%' || p_term || '%'
      OR c.city                  ILIKE '%' || p_term || '%'
      OR c.phone                 ILIKE '%' || p_term || '%'
      -- Contact name match
      OR cc.full_name            ILIKE '%' || p_term || '%'
      -- Strategy 2: trigram fuzzy (handles misspellings)
      OR (c.company_name IS NOT NULL AND similarity(c.company_name, p_term) > 0.25)
      OR similarity(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''), p_term) > 0.25
      -- Strategy 3: stripped alphanumeric match
      OR regexp_replace(coalesce(c.company_name, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(p_term, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    c.id,
    -- Boost exact substring matches
    CASE
      WHEN c.company_name ILIKE '%' || p_term || '%' THEN 0
      WHEN (c.first_name || ' ' || c.last_name) ILIKE '%' || p_term || '%' THEN 1
      WHEN c.email ILIKE '%' || p_term || '%' THEN 2
      ELSE 3
    END
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_customers_fuzzy(uuid, text) TO authenticated, service_role;

-- ── Vendor fuzzy search function ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_vendors_fuzzy(
  p_org_id uuid,
  p_term   text
)
RETURNS TABLE (
  id              uuid,
  name            text,
  primary_contact text,
  primary_email   text,
  primary_phone   text,
  city            text,
  is_active       boolean,
  created_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id,
    v.name::text,
    v.primary_contact::text,
    v.primary_email::text,
    v.primary_phone::text,
    v.city::text,
    v.is_active,
    v.created_at
  FROM vendors v
  WHERE v.organization_id = p_org_id
    AND (
      v.name             ILIKE '%' || p_term || '%'
      OR v.primary_contact ILIKE '%' || p_term || '%'
      OR v.primary_email   ILIKE '%' || p_term || '%'
      OR v.city            ILIKE '%' || p_term || '%'
      OR v.primary_phone   ILIKE '%' || p_term || '%'
      OR (v.name IS NOT NULL AND similarity(v.name, p_term) > 0.25)
      OR regexp_replace(coalesce(v.name, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(p_term, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    CASE WHEN v.name ILIKE '%' || p_term || '%' THEN 0 ELSE 1 END,
    v.name
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_vendors_fuzzy(uuid, text) TO authenticated, service_role;

-- Migration 097: Add city, state, terms, tags, created_at to search_customers_fuzzy.
--
-- The live function returns only (id, first_name, last_name, company_name, email,
-- phone, status, is_active) because it predates the address/account columns.
-- This migration adds the five missing columns while keeping the existing signature
-- (p_limit parameter), WHERE clause, and ORDER BY logic unchanged.
--
-- Run in the Supabase SQL Editor. CREATE OR REPLACE is idempotent.

CREATE OR REPLACE FUNCTION public.search_customers_fuzzy(
  p_org_id uuid,
  p_term   text,
  p_limit  integer DEFAULT 50
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
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (c.id)
    c.id, c.first_name, c.last_name, c.company_name, c.email, c.phone,
    c.city, c.state, c.status, c.terms, c.is_active, c.tags, c.created_at
  FROM customers c
  WHERE c.organization_id = p_org_id
    AND (
      c.company_name ILIKE '%'||p_term||'%'
      OR (c.first_name||' '||c.last_name) ILIKE '%'||p_term||'%'
      OR c.email ILIKE '%'||p_term||'%'
      OR c.phone ILIKE '%'||p_term||'%'
      OR similarity(coalesce(c.company_name,''), p_term) > 0.25
      OR similarity(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''), p_term) > 0.25
      OR regexp_replace(coalesce(c.company_name,''),'[^a-zA-Z0-9]','','g')
           ILIKE '%'||regexp_replace(p_term,'[^a-zA-Z0-9]','','g')||'%'
    )
  ORDER BY c.id,
    CASE WHEN c.is_active = false THEN 1 ELSE 0 END,
    CASE WHEN c.company_name ILIKE '%'||p_term||'%' THEN 1
         WHEN similarity(coalesce(c.company_name,''),p_term)>0.25 THEN 2 ELSE 3 END
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_customers_fuzzy(uuid, text, integer) TO authenticated, service_role;

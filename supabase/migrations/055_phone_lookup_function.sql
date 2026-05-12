-- Fuzzy phone-number lookup across customers + contacts.
-- regexp_replace strips formatting so "(956) 234-5678" matches "9562345678".
-- Called from /api/customers/phone-lookup via service.rpc('lookup_by_phone', ...).

CREATE OR REPLACE FUNCTION lookup_by_phone(
  p_org_ids uuid[],
  p_digits  text         -- last 7+ cleaned digits from the search query
)
RETURNS TABLE (
  result_type  text,
  id           uuid,
  display_name text,
  company_name text,
  phone        text,
  customer_id  uuid,
  org_slug     text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Direct customer matches
  SELECT
    'customer'::text,
    c.id,
    trim(c.first_name || ' ' || c.last_name),
    c.company_name,
    c.phone,
    c.id,
    o.slug
  FROM customers c
  JOIN organizations o ON o.id = c.organization_id
  WHERE c.organization_id = ANY(p_org_ids)
    AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE '%' || p_digits || '%'

  UNION ALL

  -- Contact matches (phone or phone2)
  SELECT
    'contact'::text,
    cc.id,
    cc.full_name,
    cust.company_name,
    cc.phone,
    cc.customer_id,
    o.slug
  FROM customer_contacts cc
  JOIN customers cust ON cust.id = cc.customer_id
  JOIN organizations o  ON o.id  = cc.organization_id
  WHERE cc.organization_id = ANY(p_org_ids)
    AND (
      regexp_replace(coalesce(cc.phone,  ''), '[^0-9]', '', 'g') LIKE '%' || p_digits || '%'
      OR
      regexp_replace(coalesce(cc.phone2, ''), '[^0-9]', '', 'g') LIKE '%' || p_digits || '%'
    )

  LIMIT 10
$$;

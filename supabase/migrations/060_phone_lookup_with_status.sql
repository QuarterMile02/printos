-- Extends lookup_by_phone:
--   • adds status + customer_name columns
--   • removes LIMIT 10 (show all matches)
--   • minimum digit enforcement lowered to 2 (enforced in app layer)
CREATE OR REPLACE FUNCTION lookup_by_phone(
  p_org_ids uuid[],
  p_digits  text
)
RETURNS TABLE (
  result_type   text,
  id            uuid,
  display_name  text,
  company_name  text,
  phone         text,
  customer_id   uuid,
  org_slug      text,
  status        text,
  customer_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    'customer'::text,
    c.id,
    trim(c.first_name || ' ' || c.last_name),
    c.company_name,
    c.phone,
    c.id,
    o.slug,
    c.status,
    trim(c.first_name || ' ' || c.last_name)
  FROM customers c
  JOIN organizations o ON o.id = c.organization_id
  WHERE c.organization_id = ANY(p_org_ids)
    AND c.is_active IS NOT FALSE
    AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE '%' || p_digits || '%'

  UNION ALL

  SELECT
    'contact'::text,
    cc.id,
    cc.full_name,
    cust.company_name,
    cc.phone,
    cc.customer_id,
    o.slug,
    cust.status,
    trim(cust.first_name || ' ' || cust.last_name)
  FROM customer_contacts cc
  JOIN customers cust ON cust.id = cc.customer_id
  JOIN organizations o  ON o.id  = cc.organization_id
  WHERE cc.organization_id = ANY(p_org_ids)
    AND cust.is_active IS NOT FALSE
    AND (
      regexp_replace(coalesce(cc.phone,  ''), '[^0-9]', '', 'g') LIKE '%' || p_digits || '%'
      OR
      regexp_replace(coalesce(cc.phone2, ''), '[^0-9]', '', 'g') LIKE '%' || p_digits || '%'
    )
$$;

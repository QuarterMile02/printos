-- ============================================================
-- Migration 127: Trigram fuzzy search — Products, Materials, Jobs,
-- Quotes, Sales Orders, Purchase Orders, Invoices
-- Applied: NOT YET APPLIED — proposed only, paste into Supabase SQL editor to run
-- ============================================================
--
-- Extends the trigram fuzzy search pattern from migration 062
-- (search_customers_fuzzy / search_vendors_fuzzy) to the remaining 7
-- searchable list pages. Same 3-strategy match per text field, confirmed
-- against the live 062 implementation before writing this:
--   1. Exact substring          — col ILIKE '%term%'
--   2. Trigram fuzzy            — similarity(col, term) > 0.25 (tolerates misspellings)
--   3. Stripped-alphanumeric    — regexp_replace(col,'[^a-zA-Z0-9]','','g') ILIKE
--                                 same-stripped term (tolerates punctuation/spacing)
--
-- ── Products & Materials ──
-- Straightforward single-table text search, same shape as
-- search_vendors_fuzzy. Products' RPC preserves the exact 4-field match
-- the client currently does with .includes() (name/part_number/
-- category_name/product_type) -- this is the one page being wired this
-- pass; it moves search off the client (previously capped at whatever
-- subset of up to 1000 preloaded rows happened to be in memory, silently
-- missing anything beyond that) onto a real server-side RPC scanning the
-- whole table. Materials' RPC preserves its exact current SEARCH_COLUMNS
-- = ['name','external_name','part_number','sku'].
--
-- ── Jobs ──
-- Scoped to `title` only, matching current SEARCH_COLUMNS = ['title']
-- exactly -- not silently expanding search scope to customer name or
-- job_number in this pass (jobs.customer_id has no denormalized name
-- column; that'd be a separate, larger change to consider later).
--
-- ── Quotes / Sales Orders / Purchase Orders / Invoices ──
-- These four already have a custom TypeScript searchFn (not plain ILIKE)
-- because each combines a nested customer/vendor-name lookup with a
-- numeric equality (dollar amount vs. a cents- or dollars-stored total,
-- and an exact quote/SO/PO/invoice-number match) -- something
-- PostgREST's `.or()` filter grammar cannot express in one call
-- (confirmed via the "failed to parse logic tree" errors documented in
-- each actions.ts). Writing this as a real SQL function instead of the
-- current two-round-trip PostgREST approach sidesteps that limitation
-- entirely -- a SQL function can freely JOIN and reference joined
-- columns -- AND lets the customer/vendor-name portion gain the same
-- trigram fuzziness as everything else (previously an exact ILIKE only,
-- via a separate preliminary query). The existing numeric exact-match
-- semantics are preserved unchanged:
--   - quotes.total / sales_orders.total / invoices.total are integer
--     CENTS -- typed dollar term is parsed, *100, rounded, compared with =
--   - purchase_orders.total is NUMERIC(12,2) real DOLLARS (confirmed via
--     purchase_orders/actions.ts's own docstring) -- typed term is
--     rounded to 2 decimals and compared directly, NOT *100
--   - quote_number / so_number / po_number / invoice_number are all
--     plain integers -- typed term is matched with exact equality when
--     it's a bare integer, never ILIKE/cast
--
-- Wiring into each page's search input happens incrementally, one page
-- at a time, in separate follow-up commits -- this migration only adds
-- the RPCs. Do not run until each page using it has been reviewed live.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Trigram indexes ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin(name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_materials_name_trgm
  ON materials USING gin(name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_title_trgm
  ON jobs USING gin(title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_quotes_title_trgm
  ON quotes USING gin(title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sales_orders_title_trgm
  ON sales_orders USING gin(title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_title_trgm
  ON purchase_orders USING gin(title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_invoices_title_trgm
  ON invoices USING gin(title gin_trgm_ops);

-- ── Products ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_products_fuzzy(
  p_org_id uuid,
  p_term   text
)
RETURNS TABLE (
  id               uuid,
  name             text,
  part_number      text,
  category_name    text,
  product_type     text,
  pricing_type     text,
  formula          text,
  price            numeric,
  status           text,
  active           boolean,
  is_enabled       boolean,
  updated_at       timestamptz,
  migration_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id, p.name::text, p.part_number::text,
    pc.name::text AS category_name,
    p.product_type::text, p.pricing_type::text, p.formula::text,
    p.price, p.status::text, p.active, p.is_enabled, p.updated_at,
    p.migration_status::text
  FROM products p
  LEFT JOIN product_categories pc ON pc.id = p.category_id
  WHERE p.organization_id = p_org_id
    AND (
      p.name         ILIKE '%' || p_term || '%'
      OR p.part_number ILIKE '%' || p_term || '%'
      OR pc.name        ILIKE '%' || p_term || '%'
      OR p.product_type ILIKE '%' || p_term || '%'
      OR (p.name IS NOT NULL AND similarity(p.name, p_term) > 0.25)
      OR regexp_replace(coalesce(p.name, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(p_term, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    CASE WHEN p.name ILIKE '%' || p_term || '%' THEN 0 ELSE 1 END,
    p.name
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_products_fuzzy(uuid, text) TO authenticated, service_role;

-- ── Materials ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_materials_fuzzy(
  p_org_id uuid,
  p_term   text
)
RETURNS TABLE (
  id               uuid,
  name             text,
  external_name    text,
  cost             numeric,
  price            numeric,
  selling_units    text,
  material_type_id uuid,
  category_id      uuid,
  active           boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id, m.name::text, m.external_name::text, m.cost, m.price,
    m.selling_units::text, m.material_type_id, m.category_id, m.active
  FROM materials m
  WHERE m.organization_id = p_org_id
    AND (
      m.name            ILIKE '%' || p_term || '%'
      OR m.external_name  ILIKE '%' || p_term || '%'
      OR m.part_number    ILIKE '%' || p_term || '%'
      OR m.sku             ILIKE '%' || p_term || '%'
      OR (m.name IS NOT NULL AND similarity(m.name, p_term) > 0.25)
      OR regexp_replace(coalesce(m.name, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(p_term, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    CASE WHEN m.name ILIKE '%' || p_term || '%' THEN 0 ELSE 1 END,
    m.name
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_materials_fuzzy(uuid, text) TO authenticated, service_role;

-- ── Jobs ─────────────────────────────────────────────────────────────────────
-- Scoped to `title` only -- matches current SEARCH_COLUMNS = ['title'] exactly.
CREATE OR REPLACE FUNCTION search_jobs_fuzzy(
  p_org_id uuid,
  p_term   text
)
RETURNS TABLE (
  id                 uuid,
  job_number         integer,
  title              text,
  due_date           date,
  department         text,
  flag               text,
  customer_id        uuid,
  sales_order_id     uuid,
  invoice_id         uuid,
  quote_line_item_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    j.id, j.job_number, j.title::text, j.due_date, j.department::text,
    j.flag::text, j.customer_id, j.sales_order_id, j.invoice_id, j.quote_line_item_id
  FROM jobs j
  WHERE j.organization_id = p_org_id
    AND (
      j.title ILIKE '%' || p_term || '%'
      OR (j.title IS NOT NULL AND similarity(j.title, p_term) > 0.25)
      OR regexp_replace(coalesce(j.title, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(p_term, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    CASE WHEN j.title ILIKE '%' || p_term || '%' THEN 0 ELSE 1 END,
    j.job_number DESC
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_jobs_fuzzy(uuid, text) TO authenticated, service_role;

-- ── Quotes ───────────────────────────────────────────────────────────────────
-- Preserves searchQuotes()'s exact numeric semantics (dollar-to-cents on
-- `total`, exact `quote_number` equality); adds trigram fuzziness to both
-- `title` and customer-name matching (previously an exact ILIKE only, via
-- a separate round-tripped preliminary query).
CREATE OR REPLACE FUNCTION search_quotes_fuzzy(
  p_org_id uuid,
  p_term   text
)
RETURNS TABLE (
  id                    uuid,
  quote_number          integer,
  title                 text,
  status                text,
  created_at            timestamptz,
  total                 integer,
  customer_id           uuid,
  customer_first_name   text,
  customer_last_name    text,
  customer_company_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT p_term AS raw, regexp_replace(p_term, ',', '', 'g') AS commaless
  )
  SELECT DISTINCT ON (q.id)
    q.id, q.quote_number, q.title::text, q.status::text, q.created_at, q.total,
    q.customer_id, c.first_name::text, c.last_name::text, c.company_name::text
  FROM quotes q
  LEFT JOIN customers c ON c.id = q.customer_id
  CROSS JOIN t
  WHERE q.organization_id = p_org_id
    AND (
      -- Title: substring + fuzzy + stripped-alphanumeric
      q.title ILIKE '%' || t.raw || '%'
      OR (q.title IS NOT NULL AND similarity(q.title, t.raw) > 0.25)
      OR regexp_replace(coalesce(q.title, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(t.raw, '[^a-zA-Z0-9]', '', 'g') || '%'
      -- Numeric exact matches -- unchanged semantics from searchQuotes()
      OR (t.commaless ~ '^\d+(\.\d+)?$' AND q.total = ROUND(t.commaless::numeric * 100)::integer)
      OR (t.commaless ~ '^\d+$' AND q.quote_number = t.commaless::integer)
      -- Customer name: substring + fuzzy + stripped-alphanumeric (upgraded
      -- from exact-ILIKE-only)
      OR c.company_name ILIKE '%' || t.raw || '%'
      OR (coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) ILIKE '%' || t.raw || '%'
      OR (c.company_name IS NOT NULL AND similarity(c.company_name, t.raw) > 0.25)
      OR similarity(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''), t.raw) > 0.25
      OR regexp_replace(coalesce(c.company_name, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(t.raw, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    q.id,
    CASE WHEN q.title ILIKE '%' || t.raw || '%' THEN 0 ELSE 1 END
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_quotes_fuzzy(uuid, text) TO authenticated, service_role;

-- ── Sales Orders ─────────────────────────────────────────────────────────────
-- Same pattern as search_quotes_fuzzy: preserves searchSalesOrders()'s
-- numeric semantics (cents-converted `total`, exact `so_number`
-- equality), adds fuzziness to `title` and customer-name matching.
CREATE OR REPLACE FUNCTION search_sales_orders_fuzzy(
  p_org_id uuid,
  p_term   text
)
RETURNS TABLE (
  id                    uuid,
  so_number             integer,
  title                 text,
  status                text,
  total                 integer,
  created_at            timestamptz,
  customer_id           uuid,
  customer_first_name   text,
  customer_last_name    text,
  customer_company_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT p_term AS raw, regexp_replace(p_term, ',', '', 'g') AS commaless
  )
  SELECT DISTINCT ON (so.id)
    so.id, so.so_number, so.title::text, so.status::text, so.total, so.created_at,
    so.customer_id, c.first_name::text, c.last_name::text, c.company_name::text
  FROM sales_orders so
  LEFT JOIN customers c ON c.id = so.customer_id
  CROSS JOIN t
  WHERE so.organization_id = p_org_id
    AND (
      so.title ILIKE '%' || t.raw || '%'
      OR (so.title IS NOT NULL AND similarity(so.title, t.raw) > 0.25)
      OR regexp_replace(coalesce(so.title, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(t.raw, '[^a-zA-Z0-9]', '', 'g') || '%'
      OR (t.commaless ~ '^\d+(\.\d+)?$' AND so.total = ROUND(t.commaless::numeric * 100)::integer)
      OR (t.commaless ~ '^\d+$' AND so.so_number = t.commaless::integer)
      OR c.company_name ILIKE '%' || t.raw || '%'
      OR (coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) ILIKE '%' || t.raw || '%'
      OR (c.company_name IS NOT NULL AND similarity(c.company_name, t.raw) > 0.25)
      OR similarity(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''), t.raw) > 0.25
      OR regexp_replace(coalesce(c.company_name, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(t.raw, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    so.id,
    CASE WHEN so.title ILIKE '%' || t.raw || '%' THEN 0 ELSE 1 END
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_sales_orders_fuzzy(uuid, text) TO authenticated, service_role;

-- ── Purchase Orders ──────────────────────────────────────────────────────────
-- Preserves searchPurchaseOrders()'s numeric semantics: total is real
-- DOLLARS (NUMERIC(12,2), NOT cents like Quotes/SO/Invoices), so the
-- typed term is rounded to 2 decimals and compared directly, no *100
-- conversion. Vendor-name matching (previously an exact ILIKE-only
-- preliminary lookup against vendors.name) gains the same fuzziness as
-- everything else.
CREATE OR REPLACE FUNCTION search_purchase_orders_fuzzy(
  p_org_id uuid,
  p_term   text
)
RETURNS TABLE (
  id                      uuid,
  po_number               integer,
  title                   text,
  status                  text,
  total                   numeric,
  expected_delivery_date  date,
  received_date           date,
  created_at              timestamptz,
  vendor_id               uuid,
  vendor_name             text,
  sales_order_id          uuid,
  so_number               integer,
  so_title                text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT p_term AS raw, regexp_replace(p_term, ',', '', 'g') AS commaless
  )
  SELECT DISTINCT ON (po.id)
    po.id, po.po_number, po.title::text, po.status::text, po.total,
    po.expected_delivery_date, po.received_date, po.created_at,
    po.vendor_id, v.name::text AS vendor_name,
    po.sales_order_id, so.so_number, so.title::text AS so_title
  FROM purchase_orders po
  LEFT JOIN vendors v ON v.id = po.vendor_id
  LEFT JOIN sales_orders so ON so.id = po.sales_order_id
  CROSS JOIN t
  WHERE po.organization_id = p_org_id
    AND (
      po.title ILIKE '%' || t.raw || '%'
      OR (po.title IS NOT NULL AND similarity(po.title, t.raw) > 0.25)
      OR regexp_replace(coalesce(po.title, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(t.raw, '[^a-zA-Z0-9]', '', 'g') || '%'
      OR (t.commaless ~ '^\d+(\.\d+)?$' AND po.total = ROUND(t.commaless::numeric, 2))
      OR (t.commaless ~ '^\d+$' AND po.po_number = t.commaless::integer)
      OR v.name ILIKE '%' || t.raw || '%'
      OR (v.name IS NOT NULL AND similarity(v.name, t.raw) > 0.25)
      OR regexp_replace(coalesce(v.name, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(t.raw, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    po.id,
    CASE WHEN po.title ILIKE '%' || t.raw || '%' THEN 0 ELSE 1 END
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_purchase_orders_fuzzy(uuid, text) TO authenticated, service_role;

-- ── Invoices ─────────────────────────────────────────────────────────────────
-- Same pattern as Quotes/Sales Orders: preserves searchInvoices()'s
-- numeric semantics (cents-converted `total`, exact `invoice_number`
-- equality), adds fuzziness to `title` and customer-name matching.
CREATE OR REPLACE FUNCTION search_invoices_fuzzy(
  p_org_id uuid,
  p_term   text
)
RETURNS TABLE (
  id                    uuid,
  invoice_number        integer,
  title                 text,
  status                text,
  total                 integer,
  balance_due           integer,
  due_date              date,
  created_at            timestamptz,
  customer_id           uuid,
  customer_first_name   text,
  customer_last_name    text,
  customer_company_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT p_term AS raw, regexp_replace(p_term, ',', '', 'g') AS commaless
  )
  SELECT DISTINCT ON (inv.id)
    inv.id, inv.invoice_number, inv.title::text, inv.status::text, inv.total,
    inv.balance_due, inv.due_date, inv.created_at,
    inv.customer_id, c.first_name::text, c.last_name::text, c.company_name::text
  FROM invoices inv
  LEFT JOIN customers c ON c.id = inv.customer_id
  CROSS JOIN t
  WHERE inv.organization_id = p_org_id
    AND (
      inv.title ILIKE '%' || t.raw || '%'
      OR (inv.title IS NOT NULL AND similarity(inv.title, t.raw) > 0.25)
      OR regexp_replace(coalesce(inv.title, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(t.raw, '[^a-zA-Z0-9]', '', 'g') || '%'
      OR (t.commaless ~ '^\d+(\.\d+)?$' AND inv.total = ROUND(t.commaless::numeric * 100)::integer)
      OR (t.commaless ~ '^\d+$' AND inv.invoice_number = t.commaless::integer)
      OR c.company_name ILIKE '%' || t.raw || '%'
      OR (coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) ILIKE '%' || t.raw || '%'
      OR (c.company_name IS NOT NULL AND similarity(c.company_name, t.raw) > 0.25)
      OR similarity(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''), t.raw) > 0.25
      OR regexp_replace(coalesce(c.company_name, ''), '[^a-zA-Z0-9]', '', 'g')
           ILIKE '%' || regexp_replace(t.raw, '[^a-zA-Z0-9]', '', 'g') || '%'
    )
  ORDER BY
    inv.id,
    CASE WHEN inv.title ILIKE '%' || t.raw || '%' THEN 0 ELSE 1 END
  LIMIT 50
$$;

GRANT EXECUTE ON FUNCTION search_invoices_fuzzy(uuid, text) TO authenticated, service_role;

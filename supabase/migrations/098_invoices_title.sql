-- ============================================================
-- Migration 098: Add title column to invoices
-- Applied: 2026-07-28
-- ============================================================
--
-- invoices.sales_order_id has no foreign key to sales_orders (confirmed by
-- searching every migration — only shipments.sales_order_id and
-- purchase_orders.sales_order_id have that FK). Without it, PostgREST can't
-- embed sales_orders(title) into a single invoices query, so the Invoices
-- list has no way to show a title without a second query per page load.
-- Denormalizing the title onto invoices avoids that: it's copied from the
-- linked Sales Order once, at invoice-creation time, and behaves exactly
-- like Quotes'/Sales Orders' title column from then on (flat, sortable,
-- searchable with plain ILIKE).

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS title text;

-- Backfill existing invoices from their linked Sales Order's title.
-- Idempotent: only touches rows that don't already have a title.
UPDATE invoices i
SET title = so.title
FROM sales_orders so
WHERE i.sales_order_id = so.id
  AND i.title IS NULL;

-- ============================================================
-- Migration 107: shipments — standalone (non-order) shipment support
-- Applied: 2026-08-01
-- ============================================================
--
-- Part of the top-level Shipping module. A shipment must support
-- three shapes:
--   1. Tied to a real order: sales_order_id set, customer reachable
--      via the existing sales_orders join (unchanged).
--   2. Standalone but for a known customer: customer_id set directly,
--      sales_order_id null.
--   3. Fully standalone (office/general shipping): both null.
--
-- Quotes deliberately do NOT get a quote_id column here — confirmed
-- decision: Quotes stay price-estimate-only line items (see
-- quote-detail-client.tsx's "Add Shipping" panel, which never writes
-- to this table), never real trackable shipments.

ALTER TABLE public.shipments
  ALTER COLUMN sales_order_id DROP NOT NULL;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_customer
  ON public.shipments(customer_id);

-- ── carrier CHECK constraint: drop, don't realign ──────────────────────────
--
-- The original constraint (073_shipments.sql) only allowed
-- ('UPS','FedEx','USPS','Other') and was never actually written by the
-- current save action (confirmed live: the sole existing shipment row
-- has carrier = null; shipments/actions-sr.ts's payload never includes
-- a `carrier` key). Unlike shipping_methods.carrier (our own
-- controlled lowercase enum for method presets), this column is meant
-- to hold whatever carrier string EasyPost's `selected_rate.carrier`
-- actually returns after a label purchase (buyLabel() in
-- src/lib/easypost.ts already returns exactly that) -- e.g. "FedEx",
-- "UPS", "USPS", "DHLExpress", "CanadaPost" -- consumed by
-- trackingUrl() in shipments/page.tsx to build carrier-specific
-- tracking links. EasyPost's carrier accounts on this org alone
-- already include DHL Express, DHL eCommerce, and Canada Post (see
-- investigation), none of which fit the old 4-value enum. A fixed
-- CHECK list here would just break the first non-UPS/FedEx/USPS label
-- purchase, so it's dropped rather than "aligned" to a still-incomplete
-- list -- this column reflects an external API's vocabulary, not one
-- we control.

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.shipments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%carrier%'
  LOOP
    EXECUTE format('ALTER TABLE public.shipments DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

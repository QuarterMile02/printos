-- ============================================================
-- Migration 108: Shipments — persist destination address
-- Applied: 2026-08-01
-- ============================================================
--
-- The "New Shipment" form (Part 2 of the Shipping module) collects a
-- destination address (name/street/city/state/zip) to call EasyPost's
-- rates API, but the shipments table never had columns to store it — the
-- address was only ever used transiently in the browser and lost the
-- moment a Pending shipment was saved. This blocks the Shipment Detail
-- page's "resume" flow for Pending shipments, which needs to reload the
-- destination the user already entered instead of starting blank.

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS ship_to_name   text,
  ADD COLUMN IF NOT EXISTS ship_to_street text,
  ADD COLUMN IF NOT EXISTS ship_to_city   text,
  ADD COLUMN IF NOT EXISTS ship_to_state  text,
  ADD COLUMN IF NOT EXISTS ship_to_zip    text;

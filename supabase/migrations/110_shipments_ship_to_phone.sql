-- ============================================================
-- Migration 110: Shipments — persist destination phone
-- Applied: 2026-08-03
-- ============================================================
--
-- EasyPost requires a phone number on the destination address for FedEx
-- specifically (rejects rate/label requests with PHONENUMBER.EMPTY
-- otherwise) -- USPS and others don't need it, but no phone field existed
-- anywhere in the destination-address flow. Adding one alongside the rest
-- of the ship_to_* columns from migration 108, same reasoning: without a
-- column, a Pending shipment's phone would be lost on save and the
-- Shipment Detail page's "resume" flow would reset it to blank on reload.

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS ship_to_phone text;

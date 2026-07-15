-- ============================================================
-- Migration 075: EasyPost shipment and tracker ID columns
-- Applied: 2026-07-14
-- Adds easypost_shipment_id and easypost_tracker_id so that
-- purchased labels and live tracking can be linked back to the
-- EasyPost API objects. Also ensures label_url exists in case
-- migration 074 was not applied.
-- ============================================================

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS label_url              text,
  ADD COLUMN IF NOT EXISTS easypost_shipment_id   text,
  ADD COLUMN IF NOT EXISTS easypost_tracker_id    text;

-- Columns inherit the table-level grants set in migration 073;
-- re-declare here for completeness and any fresh environments.
GRANT SELECT                          ON public.shipments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.shipments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.shipments TO service_role;

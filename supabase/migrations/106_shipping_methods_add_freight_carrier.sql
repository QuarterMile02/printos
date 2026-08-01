-- ============================================================
-- Migration 106: shipping_methods.carrier — add 'freight'
-- Applied: 2026-08-01
-- ============================================================
--
-- The original carrier CHECK constraint (074_shipping_foundation.sql)
-- allows: 'fedex', 'ups', 'usps', 'easypost', 'local', 'pickup', 'other'.
-- Freight is a distinct, common shipping method for print shops (large/
-- palletized items) — 'other' would work as a catch-all, but 'freight'
-- is a real enough category to deserve its own value rather than being
-- indistinguishable from any other miscellaneous method by carrier alone.
--
-- Finds and drops whatever the actual constraint is named (rather than
-- assuming Postgres's default `shipping_methods_carrier_check` naming)
-- so this is safe regardless of how the constraint actually got created.

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.shipping_methods'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%carrier%'
  LOOP
    EXECUTE format('ALTER TABLE public.shipping_methods DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.shipping_methods ADD CONSTRAINT shipping_methods_carrier_check
  CHECK (carrier IN ('fedex', 'ups', 'usps', 'easypost', 'local', 'pickup', 'freight', 'other'));

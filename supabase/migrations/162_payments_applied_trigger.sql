-- ============================================================
-- Migration 162: payments.applied -- recalculated by trigger from
-- payment_applications (all target types, unlike migration 161 which
-- only cares about invoice-targeted rows).
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- payments.balance is a GENERATED column (migration 158) computed as
-- amount_paid - applied - refunded_amount, so keeping `applied`
-- correct here is what keeps `balance` (and therefore the Unapplied
-- Payments query: payments where balance > 0) correct, with zero
-- separate trigger needed for balance itself.

CREATE OR REPLACE FUNCTION recalc_payment_applied(p_payment_id uuid) RETURNS void AS $$
DECLARE
  v_applied integer;
BEGIN
  SELECT COALESCE(SUM(amount_applied), 0) INTO v_applied
    FROM payment_applications
   WHERE payment_id = p_payment_id;

  UPDATE payments
     SET applied = v_applied,
         updated_at = now()
   WHERE id = p_payment_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_payment_applications_recalc_payment() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_payment_applied(OLD.payment_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM recalc_payment_applied(OLD.payment_id);
    IF NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
      PERFORM recalc_payment_applied(NEW.payment_id);
    END IF;
    RETURN NEW;
  ELSE
    PERFORM recalc_payment_applied(NEW.payment_id);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_applications_recalc_payment
  AFTER INSERT OR UPDATE OR DELETE ON payment_applications
  FOR EACH ROW
  EXECUTE FUNCTION trg_payment_applications_recalc_payment();

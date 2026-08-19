-- ============================================================
-- Migration 164: payments.refunded_amount -- recalculated by trigger
-- from refunds, same reasoning as migration 162 for applied.
-- Applied: PROPOSED, NOT run.
-- ============================================================

CREATE OR REPLACE FUNCTION recalc_payment_refunded(p_payment_id uuid) RETURNS void AS $$
DECLARE
  v_refunded integer;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_refunded
    FROM refunds
   WHERE payment_id = p_payment_id;

  UPDATE payments
     SET refunded_amount = v_refunded,
         updated_at = now()
   WHERE id = p_payment_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_refunds_recalc_payment() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_payment_refunded(OLD.payment_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM recalc_payment_refunded(OLD.payment_id);
    IF NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
      PERFORM recalc_payment_refunded(NEW.payment_id);
    END IF;
    RETURN NEW;
  ELSE
    PERFORM recalc_payment_refunded(NEW.payment_id);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refunds_recalc_payment
  AFTER INSERT OR UPDATE OR DELETE ON refunds
  FOR EACH ROW
  EXECUTE FUNCTION trg_refunds_recalc_payment();

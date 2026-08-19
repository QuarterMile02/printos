-- ============================================================
-- Migration 167: record_payment() -- add gateway fields for card payments.
-- Applied: PENDING -- run manually in the Supabase SQL Editor (Ruben),
--   not auto-applied by Claude Code. (Migration 165, the function this
--   replaces, IS already live in production -- confirmed this session
--   via a live RPC probe, its "PROPOSED, NOT run" comment is stale.)
-- ============================================================
--
-- Authorize.net card payments (Accept.js) go through this SAME function,
-- not a second write path -- the whole payments redesign exists because
-- two disconnected paths each did half the job (see migration 165's own
-- header). This just adds three new optional trailing parameters so a
-- card charge can populate payments.gateway_transaction_id/card_last4/
-- card_brand (columns already added by migration 158) through the exact
-- same insert + transactional-application logic every other payment
-- method already uses.
--
-- Backward compatible: new params are appended at the end with DEFAULT
-- NULL. Supabase's PostgREST calls this by named parameter (the JS
-- client sends a JSON object, not positional args), so every existing
-- caller that omits these three keys gets NULL for them, exactly like
-- check payments already get NULL for card_last4/card_brand today.
--
-- Ordering guarantee this exists to support (enforced by the CALLER,
-- not this function): a card charge must go to Authorize.net FIRST, and
-- this function must only be invoked after that charge succeeds. This
-- function has no way to know whether a charge succeeded -- it just
-- records whatever it's told -- so the caller-side ordering is what
-- actually prevents a payments row for a card that was never charged.
--
-- DROP first, not just CREATE OR REPLACE: Postgres resolves overloaded
-- functions by argument count/types, so appending 3 new parameters
-- (even with DEFAULTs) would leave the old 9-arg signature registered
-- as a SEPARATE overload alongside this 12-arg one, not replace it in
-- place -- two record_payment functions live at once, resolved by
-- Postgres's "fewest defaults wins" rule for existing 9-arg callers.
-- That would technically still work but is confusing to leave behind;
-- drop the old signature explicitly so there's exactly one function.

DROP FUNCTION IF EXISTS record_payment(uuid, uuid, integer, text, date, text, text, uuid, jsonb);

CREATE OR REPLACE FUNCTION record_payment(
  p_organization_id uuid,
  p_customer_id uuid,
  p_amount_paid integer,
  p_payment_method text,
  p_paid_on date,
  p_note text,
  p_check_number text,
  p_created_by uuid,
  p_applications jsonb,
  p_gateway_transaction_id text DEFAULT NULL,
  p_card_last4 text DEFAULT NULL,
  p_card_brand text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_payment_id uuid;
  v_app jsonb;
  v_target_type text;
  v_target_id uuid;
  v_amount_applied integer;
  v_total_applied integer := 0;
BEGIN
  IF p_amount_paid <= 0 THEN
    RAISE EXCEPTION 'amount_paid must be positive';
  END IF;

  INSERT INTO payments (
    organization_id, customer_id, amount_paid, payment_method,
    paid_on, note, check_number, created_by,
    gateway_transaction_id, card_last4, card_brand
  ) VALUES (
    p_organization_id, p_customer_id, p_amount_paid, p_payment_method,
    p_paid_on, p_note, p_check_number, p_created_by,
    p_gateway_transaction_id, p_card_last4, p_card_brand
  ) RETURNING id INTO v_payment_id;

  FOR v_app IN SELECT * FROM jsonb_array_elements(COALESCE(p_applications, '[]'::jsonb))
  LOOP
    v_target_type := v_app->>'target_type';
    v_target_id := (v_app->>'target_id')::uuid;
    v_amount_applied := (v_app->>'amount_applied')::integer;

    IF v_target_type NOT IN ('quote', 'sales_order', 'invoice') THEN
      RAISE EXCEPTION 'invalid target_type: %', v_target_type;
    END IF;
    IF v_amount_applied IS NULL OR v_amount_applied <= 0 THEN
      RAISE EXCEPTION 'amount_applied must be positive';
    END IF;

    v_total_applied := v_total_applied + v_amount_applied;

    INSERT INTO payment_applications (
      organization_id, payment_id, quote_id, sales_order_id, invoice_id,
      amount_applied, applied_by
    ) VALUES (
      p_organization_id,
      v_payment_id,
      CASE WHEN v_target_type = 'quote' THEN v_target_id END,
      CASE WHEN v_target_type = 'sales_order' THEN v_target_id END,
      CASE WHEN v_target_type = 'invoice' THEN v_target_id END,
      v_amount_applied,
      p_created_by
    );
  END LOOP;

  IF v_total_applied > p_amount_paid THEN
    RAISE EXCEPTION 'total applied (%) exceeds amount paid (%)', v_total_applied, p_amount_paid;
  END IF;

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql;

grant execute on function record_payment(uuid, uuid, integer, text, date, text, text, uuid, jsonb, text, text, text) to authenticated;
grant execute on function record_payment(uuid, uuid, integer, text, date, text, text, uuid, jsonb, text, text, text) to service_role;

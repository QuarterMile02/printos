-- ============================================================
-- Migration 101: Add unit to purchase_order_items
-- ============================================================
--
-- Stores the buying unit (e.g. "Sheet", "Roll", "Box") for a PO line
-- item. Same pattern as description/unit_cost: auto-filled from the
-- linked material's buying_units on selection, then freely editable
-- plain text — so free-text items (no material_id) can still carry a
-- sensible unit, and a saved PO item's unit survives if the linked
-- material is later deleted (material_id is ON DELETE SET NULL).

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS unit text;

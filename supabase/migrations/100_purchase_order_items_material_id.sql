-- ============================================================
-- Migration 100: Add material_id to purchase_order_items
-- ============================================================
--
-- Links PO line items to the materials catalog so the "Add Item" /
-- "Edit Item" UI can offer a materials search-select (mirroring the
-- vendor search-select in create-po-button.tsx) instead of a bare
-- free-text description field. description stays as a plain text
-- column — selecting a material auto-fills it (and unit_cost) as a
-- starting point, but both remain manually editable, and rows not
-- tied to any catalog material (e.g. a freight surcharge) still work
-- with material_id left null.
--
-- ON DELETE SET NULL: deleting a material must not cascade-delete
-- historical PO line items that referenced it.

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS material_id uuid REFERENCES materials(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_material_id
  ON purchase_order_items(material_id);

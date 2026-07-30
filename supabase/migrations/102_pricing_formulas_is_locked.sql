-- ============================================================
-- Migration 102: Add is_locked to pricing_formulas
-- ============================================================
--
-- Distinct from the existing is_system flag. is_system means "one of
-- the built-in formulas seeded by PrintOS" (organization_id is null,
-- shared across every org, permanently uneditable, no toggle). is_locked
-- is a new, separate concept: an Owner can lock or unlock ANY formula
-- (system or org-owned) to make it read-only, independent of whether
-- it's a built-in formula. Defaulting to false preserves current
-- behavior for every existing row until an Owner explicitly locks one.

ALTER TABLE pricing_formulas
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

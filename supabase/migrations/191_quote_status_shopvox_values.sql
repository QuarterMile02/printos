-- ============================================================
-- Migration 191: add missing quote_status enum values from ShopVOX
-- (renumbered from 124 — collided with an existing 124_form_field_settings.sql
-- pulled in from another machine; content unchanged, only the number/name moved)
-- Applied: 2026-08-29
-- ============================================================
--
-- ShopVOX quotes can carry a status of 'approved_with_changes' or
-- 'no_charge_approved'. Neither value existed in the PrintOS
-- quote_status enum, which caused 3 quotes to fail promotion.
--
-- Note: 'approve_with_changes' (no "d") already existed in the enum
-- and appears to have been a typo of the ShopVOX value
-- 'approved_with_changes' rather than an intentional distinct status.
-- It is left in place here; not removed by this migration.

alter type quote_status add value if not exists 'approved_with_changes';
alter type quote_status add value if not exists 'no_charge_approved';

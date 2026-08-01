-- ============================================================
-- Migration 105: customers.shipping_method (backfill)
-- Applied: 2026-07-31
-- ============================================================
--
-- This column already exists in production and is actively read/
-- written by the Customer "Account Info" edit card (see
-- customer-detail-client.tsx and customers/actions.ts) — it was never
-- checked in as a migration, discovered as schema drift while
-- investigating the shipping restructure. Backfilling with
-- `IF NOT EXISTS` so it's a safe no-op in production and a real add
-- on any fresh environment.
--
-- Stores the shipping_methods.name string directly (denormalized, not
-- an FK) — that's the existing behavior, unchanged by this migration.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_method text;

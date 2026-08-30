-- ============================================================
-- ⚠ WARNING — read before touching 159-166, or `refunds`/`payments` at all.
-- Migrations 159-166 (including 163_refunds_table.sql and
-- 164_payments_refunded_trigger.sql) are each self-labeled
-- "Applied: PROPOSED, NOT run." and were never applied to the live
-- database. They describe a DIFFERENT `refunds` table than the one this
-- migration reconstructs — independently confirmed, not just their own
-- header's claim: 163's `created_by uuid REFERENCES auth.users(id)` has
-- no matching FK live (live `created_by` carries no <fk/> annotation at
-- all, per PostgREST's OpenAPI schema), and 163 omits `shopvox_id`/
-- `shopvox_imported_at`/`is_historical` entirely even though the live
-- table has all three, populated on 39 real historical rows.
--   - Running 163 today would FAIL OUTRIGHT: `CREATE TABLE refunds` has
--     no `IF NOT EXISTS`, and a `refunds` table already exists live with
--     39 rows in it.
--   - Running 164 would NOT document the real live trigger — it would
--     create a second, differently-shaped, parallel
--     recalc_payment_refunded(p_payment_id uuid)/trigger pair alongside
--     whatever undocumented trigger is actually live and already firing
--     (confirmed live 2026-08-29: promoting a refund correctly updated
--     payment #9040's refunded_amount to 106 — via some trigger that is
--     NOT 164's, since 164 was never run).
-- Do not resolve this migration's own TODOs (below) by assuming 163/164
-- answer them. They don't.
-- ============================================================
--
-- Migration 193: reconstruct the `refunds` table from live schema
-- (renumbered from 126 — collided with an existing 126_form_field_settings_seed2.sql
-- pulled in from another machine; content unchanged, only the number/name moved)
-- Reconstructed: 2026-08-29 (original creation date unknown — undocumented)
-- ============================================================
--
-- `refunds`, its `payment_id` FK to `payments`, and the
-- `recalc_payment_refunded()` function/trigger that derives
-- `payments.refunded_amount` from it all exist ONLY in the live database.
-- Zero hits for any of the three across supabase/migrations/ or
-- src/supabase/migrations/ before this file — confirmed by grep, not
-- assumed. This migration exists so the schema is reproducible from
-- migrations; it does not change anything (already live, per Ruben).
--
-- SOURCE FOR THE TABLE DEFINITION BELOW: live column list read via
-- PostgREST's OpenAPI schema (GET /rest/v1/, definitions.refunds) on
-- 2026-08-29 — the same live-schema source used throughout this
-- project's migration scripts (see promote-shopvox-to-native.mjs's own
-- header on why: it's the only schema source reachable without a direct
-- Postgres connection). Every column name, type, nullability, and default
-- below is read from that response, not guessed. What that source CANNOT
-- tell you — and what is NOT independently verified here — is called out
-- explicitly in each block below rather than being asserted as fact.
--
-- KNOWN LIMITATION OF THE OpenAPI SOURCE, same class of gap documented
-- elsewhere in this project (see promote-shopvox-to-native.mjs's
-- GENERATED COLUMNS note re: payments.balance): it does not distinguish
-- a generated column from an ordinary one, and it exposes nothing about
-- CHECK constraints, index definitions beyond the bare fact of a FK,
-- RLS policies, or triggers. None of those exist in this migration
-- unless called out below as independently confirmed some other way.

create table if not exists public.refunds (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id),
  refund_number         integer,
  payment_id            uuid not null references public.payments(id),
  amount                integer not null, -- cents, matches payments.amount_paid's convention (confirmed: OpenAPI reports "format": "integer", not "numeric")
  payment_method        text,
  refunded_on           date,
  note                  text,
  created_by            uuid, -- no FK live (confirmed: OpenAPI's created_by property carries no <fk/> annotation, unlike organization_id/payment_id) — same "historical rows have no PrintOS user" shape as credit_memos.created_by
  created_at            timestamptz not null default now(),
  shopvox_id            uuid,
  shopvox_imported_at   timestamptz,
  is_historical         boolean not null default false
);

-- FK ON DELETE behavior (CASCADE/RESTRICT/SET NULL/NO ACTION) is NOT
-- exposed by the OpenAPI source and NOT independently confirmed live (no
-- pg_catalog access this session) — left as Postgres's default NO ACTION
-- above rather than guessing. Verify against
-- pg_get_constraintdef((select oid from pg_constraint where conname =
-- 'refunds_organization_id_fkey')) before assuming either way.

-- Partial unique index on shopvox_id — NOT independently confirmed live
-- via pg_indexes this session (same access gap as above). Included
-- because this project's own promoter script (scripts/promote-refunds.mjs,
-- and the instruction that produced it) states explicitly that
-- shopvox_id is a partial unique index and cannot be used as a
-- supabase-js .upsert() ON CONFLICT target — the same reason every other
-- promoted table in this project (quotes, payments, purchase_orders, …)
-- has exactly this shape of index. Verify with:
--   select indexdef from pg_indexes where tablename = 'refunds';
-- before relying on this line as confirmed rather than inferred.
create unique index if not exists refunds_shopvox_id_key
  on public.refunds (shopvox_id)
  where shopvox_id is not null;

-- ── Grants ──────────────────────────────────────────────────────────
-- NOT independently confirmed against live information_schema.role_table_
-- grants (no access this session — see header). service_role's own
-- SELECT/INSERT/UPDATE against this table IS functionally proven live
-- (scripts/promote-refunds.mjs successfully wrote and read 39 rows this
-- session using SUPABASE_SERVICE_ROLE_KEY), so service_role grants below
-- are at minimum consistent with observed behavior, not purely assumed.
-- authenticated and anon are NOT verified either way — an ad hoc anon-key
-- probe this session returned inconsistent results across query shapes
-- (a plain select() got "permission denied for table refunds"; a
-- head-only count did not), which is not a result I trust enough to
-- assert a conclusion from, so it is not treated as evidence here.
-- Written to match this project's own required convention instead (see
-- supabase/migrations/_TEMPLATE_migration.sql) — confirm against
-- information_schema.role_table_grants before relying on this section.
grant select                          on public.refunds to anon;
grant select, insert, update, delete  on public.refunds to authenticated;
grant select, insert, update, delete  on public.refunds to service_role;

-- ── RLS ─────────────────────────────────────────────────────────────
-- TODO: RLS enablement and policy definitions for `refunds` are NOT
-- known and NOT reconstructed here. This requires
--   select relrowsecurity, relforcerowsecurity from pg_class where relname = 'refunds';
--   select policyname, cmd, qual, with_check from pg_policies where tablename = 'refunds';
-- run from the SQL Editor (see scripts/schema-audit-po-credit-refund-vendor.sql,
-- which already contains this exact query pasted and ready to run — it
-- was never run/its output never captured, per the investigation that
-- produced this migration). Do NOT assume RLS is enabled, or that it
-- mirrors payments' policy, without running that query first — refunds
-- is financial data and an incorrect assumption here in either direction
-- (assuming protection that isn't there, or adding protection that
-- breaks a live access pattern) is a real risk.

-- ── enforce_historical_immutability trigger ────────────────────────
-- TODO: whether this table carries the enforce_historical_immutability
-- BEFORE UPDATE OR DELETE trigger (see Migration A/H elsewhere in this
-- project) is documented for quotes/sales_orders/invoices/jobs/payments/
-- refunds/quote_line_items (Migration A) and purchase_orders/
-- purchase_order_items (Migration H) in scripts/SHOPVOX_MIGRATION_NOTES.md
-- — 'refunds' IS named in that Migration A list, for what it's worth, but
-- that note was never independently re-verified against a live
-- information_schema.triggers query in this session either. Confirm with:
--   select trigger_name, action_timing, event_manipulation
--   from information_schema.triggers
--   where event_object_table = 'refunds';
-- before writing any code (e.g. a future SEAL step) that depends on it.

-- ============================================================
-- recalc_payment_refunded() — CANNOT BE RECONSTRUCTED. DO NOT INVENT.
-- ============================================================
--
-- This function (and whatever trigger invokes it on `refunds`) exists
-- live and is known, from observed behavior only, to:
--   - fire on a write to `refunds` (INSERT confirmed by direct
--     observation this session — writing 39 refunds via
--     scripts/promote-refunds.mjs caused payments.refunded_amount to
--     update correctly, e.g. payment #9040: amount_paid=48500,
--     applied=48394, refunded_amount became 106, matching its one
--     refund exactly. UPDATE/DELETE behavior on `refunds` was NOT
--     tested and is unknown.)
--   - derive payments.refunded_amount as SUM(refunds.amount) for the
--     matching payment_id (per scripts/SHOPVOX_MIGRATION_NOTES.md,
--     itself sourced from Ruben running pg_get_functiondef live,
--     2026-08-25 — not independently re-run this session)
--   - UPDATE the payments row directly, which in turn feeds
--     payments.balance (a separate GENERATED ALWAYS AS
--     ((amount_paid - applied) - refunded_amount) STORED column)
--
-- Retrieving its actual body requires pg_get_functiondef(), which
-- requires a direct Postgres connection (psql, or a DATABASE_URL-based
-- client) — not available in this session (checked: no DATABASE_URL in
-- .env.local, no linked Supabase CLI project, no management-API access
-- token). PostgREST's exposed schema does not include function source.
--
-- TODO (whoever has SQL Editor / direct Postgres access):
--   select pg_get_functiondef(oid) from pg_proc where proname = 'recalc_payment_refunded';
--   select trigger_name, action_timing, event_manipulation, action_statement
--     from information_schema.triggers where event_object_table = 'refunds';
-- and paste both results into this file, replacing this comment block,
-- so the function and its trigger are captured in version control
-- instead of living only in the database. Do not write a CREATE FUNCTION
-- here from guesswork — an invented body that happens to look
-- plausible (e.g. a naive SUM(amount) trigger) would silently diverge
-- from the real one the moment its actual logic differs (guard clauses,
-- rounding, which operations it fires on, whether it shares the
-- shopvox_id-based historical-row guard that recalc_payment_applied()/
-- recalc_invoice_payment_totals() gained in Migration N — unconfirmed
-- for this function specifically, see scripts/SHOPVOX_MIGRATION_NOTES.md
-- 2026-08-27), and a migration file that silently doesn't match
-- production defeats the entire point of this file existing.

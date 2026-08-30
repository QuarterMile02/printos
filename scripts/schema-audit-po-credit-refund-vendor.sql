-- Task C schema audit — paste into Supabase SQL Editor, read-only (SELECT only).
-- Covers: purchase_orders, purchase_order_items, vendors, refunds.

-- 1. Columns (full detail — types, nullability, defaults, generated/identity)
select table_name, column_name, data_type, is_nullable, column_default,
       is_generated, generation_expression, is_identity, identity_generation
from information_schema.columns
where table_schema = 'public'
  and table_name in ('purchase_orders','purchase_order_items','vendors','refunds')
order by table_name, ordinal_position;

-- 2. Constraints (PK, FK, UNIQUE, CHECK) with the actual CHECK expression
select tc.table_name, tc.constraint_name, tc.constraint_type,
       pg_get_constraintdef(pgc.oid) as definition
from information_schema.table_constraints tc
join pg_constraint pgc on pgc.conname = tc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name in ('purchase_orders','purchase_order_items','vendors','refunds')
order by tc.table_name, tc.constraint_type;

-- 3. Indexes (including partial-unique-index details, same class of gotcha as shopvox_id elsewhere)
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('purchase_orders','purchase_order_items','vendors','refunds')
order by tablename, indexname;

-- 4. RLS policies
select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('purchase_orders','purchase_order_items','vendors','refunds')
order by tablename, cmd;

-- 5. Whether RLS is even enabled on these tables
select relname as table_name, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where relname in ('purchase_orders','purchase_order_items','vendors','refunds')
  and relnamespace = 'public'::regnamespace;

-- 6. Triggers (looking specifically for enforce_historical_immutability and any number-assignment trigger)
select event_object_table as table_name, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('purchase_orders','purchase_order_items','vendors','refunds')
order by event_object_table, trigger_name;

-- 7. Confirm no credit_memo / credits table exists anywhere in the public schema
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name ilike '%credit%';

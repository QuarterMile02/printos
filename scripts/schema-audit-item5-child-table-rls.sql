-- Item 5 — RLS pattern for child tables with NO organization_id/org_id column
-- of their own, scoped only through a parent FK (purchase_order_items is one;
-- these are the other native tables in that same shape, for comparison).
-- Read-only SELECTs.

select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('purchase_order_items','discount_tiers','product_option_rates',
                     'labor_rate_departments','machine_rate_departments','job_notifications')
order by tablename, cmd;

select relname as table_name, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where relname in ('purchase_order_items','discount_tiers','product_option_rates',
                   'labor_rate_departments','machine_rate_departments','job_notifications')
  and relnamespace = 'public'::regnamespace;

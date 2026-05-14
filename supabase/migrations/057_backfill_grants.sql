-- Migration 057: Backfill explicit grants for all 48 tables
-- Applied manually via Supabase SQL editor.
-- Safe to re-run — GRANT is idempotent.
--
-- REQUIRED: Supabase policy May 2026 — explicit grants on all tables
-- created via SQL migrations (not provisioned automatically by Dashboard).
--
-- anon SELECT is intentionally withheld from sensitive tables (PII, financial,
-- org structure). RLS still applies on top of these grants for authenticated
-- and service_role, but anon is blocked at the object level.

-- ── Core / Auth ───────────────────────────────────────────────────────────────

-- profiles: no anon (PII)
grant select, insert, update, delete on public.profiles                  to authenticated;
grant select, insert, update, delete on public.profiles                  to service_role;

-- organizations: no anon (org structure)
grant select, insert, update, delete on public.organizations              to authenticated;
grant select, insert, update, delete on public.organizations              to service_role;

-- organization_members: no anon (org structure)
grant select, insert, update, delete on public.organization_members       to authenticated;
grant select, insert, update, delete on public.organization_members       to service_role;

-- organization_invites: no anon (org structure)
grant select, insert, update, delete on public.organization_invites       to authenticated;
grant select, insert, update, delete on public.organization_invites       to service_role;

-- ── Customers & Contacts ──────────────────────────────────────────────────────

-- customers: no anon (PII)
grant select, insert, update, delete on public.customers                  to authenticated;
grant select, insert, update, delete on public.customers                  to service_role;

-- customer_contacts: no anon (PII)
grant select, insert, update, delete on public.customer_contacts          to authenticated;
grant select, insert, update, delete on public.customer_contacts          to service_role;

-- ── Jobs & Notifications ──────────────────────────────────────────────────────

-- jobs: no anon (references customer data)
grant select, insert, update, delete on public.jobs                       to authenticated;
grant select, insert, update, delete on public.jobs                       to service_role;


-- job_time_logs: no anon (operational/financial detail)
grant select, insert, update, delete on public.job_time_logs              to authenticated;
grant select, insert, update, delete on public.job_time_logs              to service_role;

-- jobs_workflow_progress: no anon (references customer data)
grant select, insert, update, delete on public.jobs_workflow_progress     to authenticated;
grant select, insert, update, delete on public.jobs_workflow_progress     to service_role;

-- ── Quotes & Sales ────────────────────────────────────────────────────────────

-- quotes: no anon (financial/PII)
grant select, insert, update, delete on public.quotes                     to authenticated;
grant select, insert, update, delete on public.quotes                     to service_role;

-- quote_line_items: no anon (financial)
grant select, insert, update, delete on public.quote_line_items           to authenticated;
grant select, insert, update, delete on public.quote_line_items           to service_role;


-- sales_orders: no anon (financial/PII)
grant select, insert, update, delete on public.sales_orders               to authenticated;
grant select, insert, update, delete on public.sales_orders               to service_role;

-- ── Invoices ──────────────────────────────────────────────────────────────────

-- invoices: no anon (financial/PII)
grant select, insert, update, delete on public.invoices                   to authenticated;
grant select, insert, update, delete on public.invoices                   to service_role;

-- ── Vendors ───────────────────────────────────────────────────────────────────

-- vendors: no anon (business relationship data)
grant select, insert, update, delete on public.vendors                    to authenticated;
grant select, insert, update, delete on public.vendors                    to service_role;

-- ── Product Builder — lookup tables (anon SELECT allowed) ────────────────────

grant select                         on public.pricing_formulas           to anon;
grant select, insert, update, delete on public.pricing_formulas           to authenticated;
grant select, insert, update, delete on public.pricing_formulas           to service_role;

grant select                         on public.material_types             to anon;
grant select, insert, update, delete on public.material_types             to authenticated;
grant select, insert, update, delete on public.material_types             to service_role;

grant select                         on public.material_categories        to anon;
grant select, insert, update, delete on public.material_categories        to authenticated;
grant select, insert, update, delete on public.material_categories        to service_role;

grant select                         on public.product_categories         to anon;
grant select, insert, update, delete on public.product_categories         to authenticated;
grant select, insert, update, delete on public.product_categories         to service_role;

grant select                         on public.departments                to anon;
grant select, insert, update, delete on public.departments                to authenticated;
grant select, insert, update, delete on public.departments                to service_role;

grant select                         on public.labor_rates                to anon;
grant select, insert, update, delete on public.labor_rates                to authenticated;
grant select, insert, update, delete on public.labor_rates                to service_role;

grant select                         on public.machine_rates              to anon;
grant select, insert, update, delete on public.machine_rates              to authenticated;
grant select, insert, update, delete on public.machine_rates              to service_role;

grant select                         on public.materials                  to anon;
grant select, insert, update, delete on public.materials                  to authenticated;
grant select, insert, update, delete on public.materials                  to service_role;

grant select                         on public.material_vendors           to anon;
grant select, insert, update, delete on public.material_vendors           to authenticated;
grant select, insert, update, delete on public.material_vendors           to service_role;

grant select                         on public.material_pricing_levels    to anon;
grant select, insert, update, delete on public.material_pricing_levels    to authenticated;
grant select, insert, update, delete on public.material_pricing_levels    to service_role;

grant select                         on public.modifiers                  to anon;
grant select, insert, update, delete on public.modifiers                  to authenticated;
grant select, insert, update, delete on public.modifiers                  to service_role;

grant select                         on public.discounts                  to anon;
grant select, insert, update, delete on public.discounts                  to authenticated;
grant select, insert, update, delete on public.discounts                  to service_role;

grant select                         on public.discount_tiers             to anon;
grant select, insert, update, delete on public.discount_tiers             to authenticated;
grant select, insert, update, delete on public.discount_tiers             to service_role;

grant select                         on public.workflow_templates         to anon;
grant select, insert, update, delete on public.workflow_templates         to authenticated;
grant select, insert, update, delete on public.workflow_templates         to service_role;

grant select                         on public.workflow_stages            to anon;
grant select, insert, update, delete on public.workflow_stages            to authenticated;
grant select, insert, update, delete on public.workflow_stages            to service_role;

grant select                         on public.product_templates          to anon;
grant select, insert, update, delete on public.product_templates          to authenticated;
grant select, insert, update, delete on public.product_templates          to service_role;

grant select                         on public.products                   to anon;
grant select, insert, update, delete on public.products                   to authenticated;
grant select, insert, update, delete on public.products                   to service_role;

grant select                         on public.product_default_items      to anon;
grant select, insert, update, delete on public.product_default_items      to authenticated;
grant select, insert, update, delete on public.product_default_items      to service_role;

grant select                         on public.product_modifiers          to anon;
grant select, insert, update, delete on public.product_modifiers          to authenticated;
grant select, insert, update, delete on public.product_modifiers          to service_role;

grant select                         on public.product_dropdown_menus     to anon;
grant select, insert, update, delete on public.product_dropdown_menus     to authenticated;
grant select, insert, update, delete on public.product_dropdown_menus     to service_role;

grant select                         on public.product_dropdown_items     to anon;
grant select, insert, update, delete on public.product_dropdown_items     to authenticated;
grant select, insert, update, delete on public.product_dropdown_items     to service_role;

grant select                         on public.product_custom_fields      to anon;
grant select, insert, update, delete on public.product_custom_fields      to authenticated;
grant select, insert, update, delete on public.product_custom_fields      to service_role;

grant select                         on public.product_option_rates       to anon;
grant select, insert, update, delete on public.product_option_rates       to authenticated;
grant select, insert, update, delete on public.product_option_rates       to service_role;

-- ── Proofs ────────────────────────────────────────────────────────────────────

grant select                         on public.proof_versions             to anon;
grant select, insert, update, delete on public.proof_versions             to authenticated;
grant select, insert, update, delete on public.proof_versions             to service_role;

-- ── Email ─────────────────────────────────────────────────────────────────────

grant select                         on public.email_templates            to anon;
grant select, insert, update, delete on public.email_templates            to authenticated;
grant select, insert, update, delete on public.email_templates            to service_role;

grant select                         on public.email_signatures           to anon;
grant select, insert, update, delete on public.email_signatures           to authenticated;
grant select, insert, update, delete on public.email_signatures           to service_role;

-- ── QuickBooks & Financial Settings ──────────────────────────────────────────

-- qb_settings: no anon (financial config)
grant select, insert, update, delete on public.qb_settings                to authenticated;
grant select, insert, update, delete on public.qb_settings                to service_role;

-- payment_methods: no anon (financial config)
grant select, insert, update, delete on public.payment_methods            to authenticated;
grant select, insert, update, delete on public.payment_methods            to service_role;

grant select                         on public.term_codes                 to anon;
grant select, insert, update, delete on public.term_codes                 to authenticated;
grant select, insert, update, delete on public.term_codes                 to service_role;

-- ── Dashboard ─────────────────────────────────────────────────────────────────

grant select                         on public.dashboard_layouts          to anon;
grant select, insert, update, delete on public.dashboard_layouts          to authenticated;
grant select, insert, update, delete on public.dashboard_layouts          to service_role;

-- ── Operational ───────────────────────────────────────────────────────────────

-- collection_call_logs: no anon (operational/PII)
grant select, insert, update, delete on public.collection_call_logs       to authenticated;
grant select, insert, update, delete on public.collection_call_logs       to service_role;

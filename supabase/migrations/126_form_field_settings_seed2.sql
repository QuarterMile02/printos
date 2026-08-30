-- ============================================================
-- Migration 126: Forms Visibility Settings — seed the remaining 6 form types
-- Applied: NOT YET APPLIED — proposed only, paste into Supabase SQL editor to run
-- ============================================================
--
-- Follow-up to 125 (Customer/Material/Product). This seeds the 6
-- remaining form types that have a real, current PrintOS create/edit
-- form with genuinely user-settable fields: Sales Order, Purchase
-- Order, Job, Vendor, Quote, Sales Lead.
--
-- Invoice is intentionally NOT seeded — it has zero genuinely
-- toggleable fields. There is no create or edit form for an invoice;
-- invoices are generated 100% programmatically off a Sales Order. The
-- only user interaction on an invoice is "Record Payment" (an amount
-- input), which isn't a direct column set -- it's a derived increment
-- across amount_paid/balance_due/status, not a field a Forms-settings
-- toggle could meaningfully apply to. Invoice stays "Not configured
-- yet" in the UI, honestly reflecting that there's nothing to
-- configure, not a gap in this seed pass.
--
-- Unlike 125, this data is NOT sourced from ShopVOX's live config --
-- these 6 PrintOS forms mostly have no ShopVOX field-for-field
-- equivalent (confirmed in the original field-mapping pass). Instead
-- this seeds every field that is genuinely exposed as an input/
-- select/checkbox on the form right now (reconciled across create +
-- edit where both exist), sourced from a fresh line-by-line
-- re-verification of each form's actual code (see chat history for
-- the full per-type inventory with file:line citations). is_required
-- is set true only where the current PrintOS form itself enforces the
-- field as required (HTML `required` attribute, an asterisked label,
-- or blocking client-side validation) -- not a guess, and not
-- ShopVOX's requiredness (there's no ShopVOX source for these 6).
--
-- Real field counts, confirmed thin/rich as applicable:
--   sales_order:    3 fields (very thin -- customer_id, contact_id, status;
--                   title/notes/total/discount_percent are real columns
--                   but display-only everywhere, no input exists)
--   purchase_order: 5 fields (thin -- title, vendor_id, expected_delivery_date,
--                   status, notes)
--   job:            10 fields (title, customer_id, description, due_date,
--                   status, contact_id, department, plus 3 phase-date
--                   fields -- production/fabrication/installation_due_date
--                   -- that are real, actively-used live columns with no
--                   defining migration; same class of finding as the
--                   earlier schema-drift report, not fixed here)
--   vendor:         25 fields (NOT thin -- richer than Customer's 20.
--                   Full address x2 + full business-info card. Only 6 of
--                   the 25 are settable at creation; the other 19 are
--                   edit-only -- see the separate review note on this)
--   quote:          11 fields (customer_id, contact_id, title, due_date,
--                   sales_rep_id, po_number, install_address,
--                   production_notes, expires_at, terms, notes -- status
--                   excluded, it's workflow-driven only, no direct control
--                   despite being a real column)
--   sales_lead:     9 fields (title, customer_id, assigned_to, stage_id,
--                   estimated_value, source, next_contact_date, notes,
--                   lost_reason -- see the separate review note: there is
--                   no edit-lead page at all, so 8 of these 9 only ever
--                   get set once, at creation)

insert into public.form_field_settings
  (organization_id, form_type, field_key, field_label, is_visible, is_required, sort_order)
select o.id, v.form_type, v.field_key, v.field_label, v.is_visible, v.is_required, v.sort_order
from public.organizations o
cross join (values
  -- ── Sales Order (3 fields) ────────────────────────────────────────
  ('sales_order', 'customer_id',            'Customer',                           true,  false, 0),
  ('sales_order', 'contact_id',              'Contact',                            true,  false, 1),
  ('sales_order', 'status',                  'Status',                             true,  false, 2),

  -- ── Purchase Order (5 fields) ─────────────────────────────────────
  ('purchase_order', 'title',                'Title',                              true,  false, 0),
  ('purchase_order', 'vendor_id',            'Vendor',                             true,  false, 1),
  ('purchase_order', 'expected_delivery_date','Expected Delivery',                 true,  false, 2),
  ('purchase_order', 'status',               'Status',                             true,  false, 3),
  ('purchase_order', 'notes',                'Notes',                              true,  false, 4),

  -- ── Job (10 fields) ───────────────────────────────────────────────
  ('job', 'title',                           'Title',                              true,  true,  0),
  ('job', 'customer_id',                     'Customer',                           true,  false, 1),
  ('job', 'description',                     'Description',                        true,  false, 2),
  ('job', 'due_date',                        'Due Date',                           true,  false, 3),
  ('job', 'status',                          'Status',                             true,  false, 4),
  ('job', 'contact_id',                      'Contact',                            true,  false, 5),
  ('job', 'department',                      'Department',                         true,  false, 6),
  ('job', 'production_due_date',             'Production Due',                     true,  false, 7),
  ('job', 'fabrication_due_date',            'Fabrication Due',                    true,  false, 8),
  ('job', 'installation_due_date',           'Installation Date',                  true,  false, 9),

  -- ── Vendor (25 fields) ────────────────────────────────────────────
  ('vendor', 'name',                         'Company Name',                       true,  true,  0),
  ('vendor', 'legal_name',                   'Legal Name',                         true,  false, 1),
  ('vendor', 'primary_contact',              'Primary Contact',                    true,  false, 2),
  ('vendor', 'primary_email',                'Email',                              true,  false, 3),
  ('vendor', 'primary_phone',                'Phone',                              true,  false, 4),
  ('vendor', 'website',                      'Website',                            true,  false, 5),
  ('vendor', 'is_active',                    'Active Vendor',                      true,  false, 6),
  ('vendor', 'street',                       'Street',                             true,  false, 7),
  ('vendor', 'city',                         'City',                               true,  false, 8),
  ('vendor', 'state',                        'State',                              true,  false, 9),
  ('vendor', 'zip',                          'Zip',                                true,  false, 10),
  ('vendor', 'country',                      'Country',                            true,  false, 11),
  ('vendor', 'secondary_street',             'Secondary Street',                   true,  false, 12),
  ('vendor', 'secondary_city',               'Secondary City',                     true,  false, 13),
  ('vendor', 'secondary_state',              'Secondary State',                    true,  false, 14),
  ('vendor', 'secondary_zip',                'Secondary Zip',                      true,  false, 15),
  ('vendor', 'account_id',                   'Account Number',                     true,  false, 16),
  ('vendor', 'terms',                        'Payment Terms',                      true,  false, 17),
  ('vendor', 'tax_id',                       'Tax ID / EIN',                       true,  false, 18),
  ('vendor', 'tax',                          'Tax',                                true,  false, 19),
  ('vendor', 'payment_method',               'Payment Method',                     true,  false, 20),
  ('vendor', 'catalog_url',                  'Catalog URL',                        true,  false, 21),
  ('vendor', 'categories',                   'Categories',                         true,  false, 22),
  ('vendor', 'hours_of_operation',           'Hours of Operation',                 true,  false, 23),
  ('vendor', 'background_info',              'Notes / Background Info',            true,  false, 24),

  -- ── Quote (11 fields) ─────────────────────────────────────────────
  ('quote', 'customer_id',                   'Customer',                           true,  true,  0),
  ('quote', 'contact_id',                    'Contact',                            true,  true,  1),
  ('quote', 'title',                         'Title',                              true,  true,  2),
  ('quote', 'due_date',                      'Due Date',                           true,  false, 3),
  ('quote', 'sales_rep_id',                  'Sales Rep',                          true,  true,  4),
  ('quote', 'po_number',                     'PO Number',                          true,  false, 5),
  ('quote', 'install_address',               'Install Address',                    true,  false, 6),
  ('quote', 'production_notes',              'Production Notes',                   true,  false, 7),
  ('quote', 'expires_at',                    'Expires',                            true,  false, 8),
  ('quote', 'terms',                         'Terms',                              true,  false, 9),
  ('quote', 'notes',                         'Internal Notes',                     true,  false, 10),

  -- ── Sales Lead (9 fields) ─────────────────────────────────────────
  ('sales_lead', 'title',                    'Title',                              true,  true,  0),
  ('sales_lead', 'customer_id',              'Customer',                           true,  false, 1),
  ('sales_lead', 'assigned_to',              'Assigned To',                        true,  false, 2),
  ('sales_lead', 'stage_id',                 'Stage',                              true,  false, 3),
  ('sales_lead', 'estimated_value',          'Estimated Value',                    true,  false, 4),
  ('sales_lead', 'source',                   'Source',                             true,  false, 5),
  ('sales_lead', 'next_contact_date',        'Next Contact Date',                  true,  false, 6),
  ('sales_lead', 'notes',                    'Notes',                              true,  false, 7),
  ('sales_lead', 'lost_reason',              'Lost Reason',                        true,  false, 8)
) as v(form_type, field_key, field_label, is_visible, is_required, sort_order)
where o.slug = 'quarter-mile-inc'
on conflict (organization_id, form_type, field_key) do nothing;

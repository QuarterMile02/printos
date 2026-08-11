-- ============================================================
-- Migration 125: Forms Visibility Settings — seed QMI's real config
-- Applied: NOT YET APPLIED — proposed only, paste into Supabase SQL editor to run
-- ============================================================
--
-- Transfers QMI's actual live ShopVOX Forms config (captured directly
-- from https://express.shopvox.com/settings/forms/* — Customer, Invoice,
-- Job, Material, Product, Purchase Order, Quote, Sales Lead, Sales
-- Order, Vendor, all 10 form types) into form_field_settings (124), for
-- the 3 forms confirmed prioritized: customer, material, product.
--
-- Scope note: only fields with a REAL PrintOS equivalent are seeded here
-- (cross-referenced against each form's actual current DB columns + UI
-- exposure — see the field-mapping report). ShopVOX-only concepts with
-- no PrintOS counterpart (e.g. Customer's "Facebook"/"Twitter", most of
-- Quote/Invoice/Job/Sales Order's fields) are intentionally NOT seeded —
-- there's nothing in the PrintOS form for a visibility toggle to apply
-- to. Invoice, Purchase Order, Job, Sales Order, Vendor, Quote, and
-- Sales Lead are left unseeded for now (out of this prioritized batch);
-- they'll show an empty state in the UI until a later seed pass.
--
-- field_label uses PrintOS's own UI label where it differs from
-- ShopVOX's (e.g. materials.external_name is labeled "Display Name" in
-- material-form.tsx, not "External Name"), since this label is what
-- QMI's admins will actually see on PrintOS's own toggle screen.
--
-- Known caveats carried over from the field-mapping pass (see the
-- separate schema-drift report — not fixed here):
--   - customers.sales_rep: only the edit-form's free-text field, not
--     the create-form's sales_rep_id dropdown (disconnected columns).
--   - materials.per_li_unit: DB column is typed `text`, not `boolean`,
--     despite being read/written as a checkbox.
--   - products.portal_enabled: condenses ShopVOX's 3 separate toggles
--     (Cportal/Shopping Cart/Web Store) into PrintOS's 1; also has no
--     defining migration (undocumented live column).

insert into public.form_field_settings
  (organization_id, form_type, field_key, field_label, is_visible, is_required, sort_order)
select o.id, v.form_type, v.field_key, v.field_label, v.is_visible, v.is_required, v.sort_order
from public.organizations o
cross join (values
  -- ── Customer (20 fields) ──────────────────────────────────────────
  ('customer', 'is_ap_contact',           'Account Payable Contact',            true,  false, 0),
  ('customer', 'background_info',         'Background Info',                    true,  false, 1),
  ('customer', 'credit_limit',            'Credit Limit',                       true,  false, 2),
  ('customer', 'discount_percent',        'Discount %',                         true,  false, 3),
  ('customer', 'industry',                'Industry',                           true,  true,  4),
  ('customer', 'lead_source',             'Lead Source',                        true,  true,  5),
  ('customer', 'pricing_level',           'Pricing Level',                      true,  false, 6),
  ('customer', 'first_name',              'First Name',                         true,  false, 7),
  ('customer', 'last_name',               'Last Name',                          true,  false, 8),
  ('customer', 'email',                   'Email',                              true,  false, 9),
  ('customer', 'phone',                   'Mobile Phone',                       true,  false, 10),
  ('customer', 'sales_rep',               'Sales Rep',                          true,  false, 11),
  ('customer', 'shipping_method',         'Shipping Method',                    true,  false, 12),
  ('customer', 'special_notes',           'Special Notes',                      true,  false, 13),
  ('customer', 'status',                  'Status',                             true,  false, 14),
  ('customer', 'tax_exempt_code',         'Tax Exempt Code',                    true,  false, 15),
  ('customer', 'tax_exempt_expires',      'Tax Exempt Expiration Date',         true,  false, 16),
  ('customer', 'taxable',                 'Taxable',                            true,  false, 17),
  ('customer', 'terms',                   'Terms',                              true,  true,  18),
  ('customer', 'website',                 'Website',                            true,  false, 19),

  -- ── Material (21 fields) ──────────────────────────────────────────
  ('material', 'buying_units',            'Buying Units',                       true,  false, 0),
  ('material', 'cog_account',             'COG Account',                        true,  true,  1),
  ('material', 'calculate_wastage',       'Calculate Wastage',                  true,  false, 2),
  ('material', 'description',             'Description',                       true,  false, 3),
  ('material', 'discount_id',             'Discount',                           true,  false, 4),
  ('material', 'display_description_in_li','Display Description in Line Item Description', true, false, 5),
  ('material', 'external_name',           'Display Name',                       true,  false, 6),
  ('material', 'formula',                 'Formula',                            true,  false, 7),
  ('material', 'include_in_base_price',   'Include in Base Price',              true,  false, 8),
  ('material', 'info_url',                'Info URL',                           true,  false, 9),
  ('material', 'po_description',          'PO Description',                     true,  true,  10),
  ('material', 'part_number',             'Part Number',                        true,  false, 11),
  ('material', 'per_li_unit',             'Per LI Unit',                        true,  false, 12),
  ('material', 'preferred_vendor',        'Preferred Vendor',                   true,  true,  13),
  ('material', 'material_pricing_tiers',  'Pricing Levels',                     false, false, 14),
  ('material', 'print_image_on_pdf',      'Print Image on PDF',                 true,  false, 15),
  ('material', 'sku',                     'SKU',                                true,  false, 16),
  ('material', 'show_internal',           'Show Internal',                      true,  false, 17),
  ('material', 'wastage_markup',          'Wastage Markup %',                   true,  false, 18),
  ('material', 'weight',                  'Weight',                             true,  false, 19),
  ('material', 'weight_uom',              'Weight UOM',                         true,  false, 20),

  -- ── Product (18 fields) ───────────────────────────────────────────
  ('product',  'volume_discount_id',      'Apply Discounts (Volume Discount)',  true,  false, 0),
  ('product',  'range_discount_id',       'Apply Range Discount for Qty',       true,  false, 1),
  ('product',  'buying_units',            'Buying Units',                       true,  false, 2),
  ('product',  'formula',                 'Formula',                            true,  false, 3),
  ('product',  'in_house_commission',     'Pay Commissions on In-House Sales',  false, false, 4),
  ('product',  'include_base_product_in_po','Include Base Product in PO',       false, false, 5),
  ('product',  'min_line_price',          'Minimum Line Price',                 true,  false, 6),
  ('product',  'min_unit_price',          'Minimum Unit Price',                 true,  false, 7),
  ('product',  'outsourced_commission',   'Pay Commissions on Outsourced Sales', false, false, 8),
  ('product',  'pricing_type',            'Pricing Type',                       true,  false, 9),
  ('product',  'print_image_on_pdf',      'Print Image On PDF',                 false, false, 10),
  ('product',  'description',             'Product Description',                true,  false, 11),
  ('product',  'production_details',      'Production Details',                 false, false, 12),
  ('product',  'secondary_category',      'Secondary Category',                 true,  false, 13),
  ('product',  'portal_enabled',          'Show on Portal / Shopping Cart / Web Store', true, false, 14),
  ('product',  'taxable',                 'Taxable',                            true,  false, 15),
  ('product',  'units',                   'Selling Units',                      true,  false, 16),
  ('product',  'workflow_template_id',    'Workflow Template',                  true,  false, 17)
) as v(form_type, field_key, field_label, is_visible, is_required, sort_order)
where o.slug = 'quarter-mile-inc'
on conflict (organization_id, form_type, field_key) do nothing;

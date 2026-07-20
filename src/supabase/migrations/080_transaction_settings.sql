CREATE TABLE IF NOT EXISTS transaction_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  show_parent_description_only boolean DEFAULT false,
  check_line_item_minimum_before_discount boolean DEFAULT false,
  allow_discount_codes boolean DEFAULT false,
  allow_line_item_taxable_override boolean DEFAULT true,
  default_include_payment_link boolean DEFAULT false,
  down_payment_type text DEFAULT 'percent',
  down_payment_amount numeric(10,2) DEFAULT 0,
  default_next_contact_date_days integer DEFAULT 7,
  hide_ordered_quotes boolean DEFAULT false,
  hide_invoiced_quotes boolean DEFAULT false,
  hide_lost_quotes boolean DEFAULT false,
  online_quote_review_by_customer boolean DEFAULT true,
  allow_change_financial_info_after_convert boolean DEFAULT false,
  default_quote_expiration_days integer DEFAULT 30,
  sync_zero_invoices boolean DEFAULT false,
  allow_editing_of_invoice boolean DEFAULT true,
  taxes_on_purchase_orders boolean DEFAULT false,
  purchase_orders_combine_items boolean DEFAULT false,
  default_po_line_item_type text DEFAULT 'Material',
  default_inhouse_commission_on text DEFAULT 'Price',
  default_outsourced_commission_on text DEFAULT 'Price',
  sales_commission_by text DEFAULT 'Closed Invoices',
  setup_charge_default numeric(10,2) DEFAULT 0,
  setup_charge_type text DEFAULT 'dollar',
  setup_charge_taxable boolean DEFAULT false,
  shipping_charge_default numeric(10,2) DEFAULT 0,
  shipping_charge_type text DEFAULT 'dollar',
  shipping_charge_taxable boolean DEFAULT false,
  finance_charge_default numeric(10,2) DEFAULT 0,
  finance_charge_type text DEFAULT 'dollar',
  finance_charge_taxable boolean DEFAULT false,
  misc_charge_default numeric(10,2) DEFAULT 0,
  misc_charge_type text DEFAULT 'dollar',
  misc_charge_taxable boolean DEFAULT false,
  misc_charge_label text DEFAULT 'Misc',
  copy_transaction_title_to_job boolean DEFAULT true,
  keep_job_in_sync_with_line_item boolean DEFAULT true,
  allow_jobs_for_quotes boolean DEFAULT false,
  allow_jobs_for_invoices boolean DEFAULT false,
  allow_jobs_without_downpayment boolean DEFAULT true,
  show_customer_pending_balance boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE transaction_settings ENABLE ROW LEVEL SECURITY;

GRANT ALL ON transaction_settings TO authenticated, service_role;

CREATE POLICY "org members can manage transaction settings"
  ON transaction_settings FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

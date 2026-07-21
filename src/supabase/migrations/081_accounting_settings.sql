CREATE TABLE IF NOT EXISTS sales_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  agency text,
  description text,
  rate numeric(6,4) DEFAULT 0,
  is_split boolean DEFAULT false,
  tax_code text,
  is_default boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE sales_taxes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON sales_taxes TO authenticated, service_role;
CREATE POLICY "org members can manage sales taxes" ON sales_taxes FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS term_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code_type text DEFAULT 'Standard',
  days integer DEFAULT 0,
  down_payment_percent numeric(5,2) DEFAULT 0,
  is_default boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE term_codes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON term_codes TO authenticated, service_role;
CREATE POLICY "org members can manage term codes" ON term_codes FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text DEFAULT 'Other',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
GRANT ALL ON payment_methods TO authenticated, service_role;
CREATE POLICY "org members can manage payment methods" ON payment_methods FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  number text,
  type text DEFAULT 'Income',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON chart_of_accounts TO authenticated, service_role;
CREATE POLICY "org members can manage chart of accounts" ON chart_of_accounts FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS account_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  accounts_receivable_id uuid REFERENCES chart_of_accounts(id),
  cost_of_goods_id uuid REFERENCES chart_of_accounts(id),
  cost_of_material_id uuid REFERENCES chart_of_accounts(id),
  custom_item_cog_id uuid REFERENCES chart_of_accounts(id),
  custom_item_income_id uuid REFERENCES chart_of_accounts(id),
  finance_charges_id uuid REFERENCES chart_of_accounts(id),
  inhouse_sales_id uuid REFERENCES chart_of_accounts(id),
  misc_charges_id uuid REFERENCES chart_of_accounts(id),
  freight_charges_id uuid REFERENCES chart_of_accounts(id),
  outsourced_sales_id uuid REFERENCES chart_of_accounts(id),
  purchase_orders_id uuid REFERENCES chart_of_accounts(id),
  setup_charges_id uuid REFERENCES chart_of_accounts(id),
  shipping_charges_id uuid REFERENCES chart_of_accounts(id),
  tax_payable_id uuid REFERENCES chart_of_accounts(id),
  undeposited_funds_id uuid REFERENCES chart_of_accounts(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE account_mapping ENABLE ROW LEVEL SECURITY;
GRANT ALL ON account_mapping TO authenticated, service_role;
CREATE POLICY "org members can manage account mapping" ON account_mapping FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS transaction_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  next_quote_number integer DEFAULT 1,
  next_sales_order_number integer DEFAULT 1,
  next_invoice_number integer DEFAULT 1,
  next_purchase_order_number integer DEFAULT 1,
  next_payment_number integer DEFAULT 1,
  next_refund_number integer DEFAULT 1,
  next_credit_memo_number integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE transaction_numbers ENABLE ROW LEVEL SECURITY;
GRANT ALL ON transaction_numbers TO authenticated, service_role;
CREATE POLICY "org members can manage transaction numbers" ON transaction_numbers FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS accounting_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  accounting_software text DEFAULT 'QuickBooks Desktop',
  accounting_method text DEFAULT 'Cash',
  program_fee_credit_card numeric(5,2) DEFAULT 0,
  program_fee_debit_card numeric(5,2) DEFAULT 0,
  program_fee_taxable boolean DEFAULT false,
  program_fee_show_disclosure boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE accounting_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON accounting_settings TO authenticated, service_role;
CREATE POLICY "org members can manage accounting settings" ON accounting_settings FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- Seed QMI sales taxes
INSERT INTO sales_taxes (organization_id, name, agency, rate, is_default, tax_code, sort_order)
SELECT org.id, t.name, t.agency, t.rate, t.is_default, t.tax_code, t.sort_order
FROM (VALUES
  ('1STATE','WebFile Tax Portal',8.25,true,'1STATE',1),
  ('2LOCAL','WebFile Tax Portal',0,false,'2LOCAL',2),
  ('EXEMPT','WebFile Tax Portal',0,false,'EXEMPT',3),
  ('Out of State','Not Available',0,false,'OutOfState',4)
) AS t(name,agency,rate,is_default,tax_code,sort_order)
CROSS JOIN (SELECT id FROM organizations WHERE slug = 'quarter-mile-inc') org
ON CONFLICT DO NOTHING;

-- Seed QMI term codes
INSERT INTO term_codes (organization_id, name, code_type, days, down_payment_percent, is_default, sort_order)
SELECT org.id, t.name, 'Standard', t.days, t.down_pct, t.is_default, t.sort_order
FROM (VALUES
  ('Net 30',30,0,false,1),
  ('Net 15',15,0,false,2),
  ('COD',0,0,false,3),
  ('60/40',0,60,true,4),
  ('Net 60',60,0,false,5),
  ('Due on receipt',0,0,false,6),
  ('Net 45',45,0,false,7)
) AS t(name,days,down_pct,is_default,sort_order)
CROSS JOIN (SELECT id FROM organizations WHERE slug = 'quarter-mile-inc') org
ON CONFLICT DO NOTHING;

-- Seed QMI payment methods
INSERT INTO payment_methods (organization_id, name, type, sort_order)
SELECT org.id, t.name, t.type, t.sort_order
FROM (VALUES
  ('Cash','Cash',1),('Check','Check',2),('AMEX','Credit Card',3),
  ('Write Off','Other',4),('Trade','Other',5),('E-Check','Other',6),
  ('Credit Card','Credit Card',7),('ACH','Other',8),
  ('CC Terminal','Other',9),('CashApp','Other',10)
) AS t(name,type,sort_order)
CROSS JOIN (SELECT id FROM organizations WHERE slug = 'quarter-mile-inc') org
ON CONFLICT DO NOTHING;

-- Seed QMI chart of accounts (key accounts only)
INSERT INTO chart_of_accounts (organization_id, name, number, type, sort_order)
SELECT org.id, t.name, t.number, t.type, t.sort_order
FROM (VALUES
  ('Sales','4000','Income',1),
  ('Cost of Goods Sold','5100','Cost of Goods Sold',2),
  ('Accounts Receivable','1210','Accounts Receivable',3),
  ('Materials','5101','Cost of Goods Sold',4),
  ('Undeposited Funds','1499','Other Current Asset',5),
  ('Freight','4030','Income',6),
  ('Sales tax','2010','Expense',7),
  ('Purchase Orders','90100','Other Current Asset',8)
) AS t(name,number,type,sort_order)
CROSS JOIN (SELECT id FROM organizations WHERE slug = 'quarter-mile-inc') org
ON CONFLICT DO NOTHING;

-- Seed QMI accounting settings
INSERT INTO accounting_settings (organization_id, accounting_software, accounting_method)
SELECT id, 'QuickBooks Desktop', 'Cash' FROM organizations WHERE slug = 'quarter-mile-inc'
ON CONFLICT DO NOTHING;

-- Seed QMI account mapping (uses subqueries to resolve COA IDs by account number)
INSERT INTO account_mapping (
  organization_id,
  accounts_receivable_id,
  cost_of_goods_id,
  cost_of_material_id,
  custom_item_cog_id,
  custom_item_income_id,
  finance_charges_id,
  inhouse_sales_id,
  misc_charges_id,
  outsourced_sales_id,
  purchase_orders_id,
  setup_charges_id,
  shipping_charges_id,
  tax_payable_id,
  undeposited_funds_id
)
SELECT
  org.id,
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '1210' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '5101' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '5101' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '5101' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '4000' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '4000' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '4000' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '4000' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '4000' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '90100' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '4000' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '4000' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '2010' LIMIT 1),
  (SELECT id FROM chart_of_accounts WHERE organization_id = org.id AND number = '1499' LIMIT 1)
FROM (SELECT id FROM organizations WHERE slug = 'quarter-mile-inc') org
ON CONFLICT DO NOTHING;

-- Seed QMI transaction numbers (defaults all start at 1)
INSERT INTO transaction_numbers (organization_id)
SELECT id FROM organizations WHERE slug = 'quarter-mile-inc'
ON CONFLICT DO NOTHING;

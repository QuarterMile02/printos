-- 038 — QuickBooks Desktop settings + payment methods + term codes
-- One-off settings table for QMI's IIF export. The IIF route reads
-- account names from here so a future change to chart-of-accounts can
-- be made by editing one row instead of redeploying.

-- ---------- qb_settings ----------
CREATE TABLE IF NOT EXISTS qb_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  accounting_method text NOT NULL DEFAULT 'Cash',
  ar_account text NOT NULL,
  ar_account_number text,
  default_income_account text NOT NULL,
  default_income_account_number text,
  tax_payable_account text NOT NULL,
  tax_payable_account_number text,
  undeposited_funds_account text NOT NULL,
  undeposited_funds_account_number text,
  cogs_account text,
  cogs_account_number text,
  default_tax_rate numeric(6,4) NOT NULL DEFAULT 0,
  default_tax_name text,
  next_invoice_number integer DEFAULT 1,
  next_so_number integer DEFAULT 1,
  next_quote_number integer DEFAULT 1,
  next_po_number integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE qb_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY qb_settings_select_members ON qb_settings FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY qb_settings_write_admins ON qb_settings FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
       WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seed QMI's chart-of-accounts. Idempotent — safe to re-run; existing
-- row for the org keeps its values via ON CONFLICT.
INSERT INTO qb_settings (
  organization_id, accounting_method,
  ar_account, ar_account_number,
  default_income_account, default_income_account_number,
  tax_payable_account, tax_payable_account_number,
  undeposited_funds_account, undeposited_funds_account_number,
  cogs_account, cogs_account_number,
  default_tax_rate, default_tax_name,
  next_invoice_number, next_so_number, next_quote_number, next_po_number
)
SELECT
  o.id, 'Cash',
  'Accounts Receivable', '1210',
  'Sales', '4000',
  'Sales tax', '2010',
  'Undeposited Funds', '1499',
  'Materials', '5101',
  8.25, 'STATE',
  8988, 8988, 12995, 2113
FROM organizations o
ON CONFLICT (organization_id) DO NOTHING;

-- ---------- payment_methods ----------
CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY payment_methods_select_members ON payment_methods FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY payment_methods_write_admins ON payment_methods FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
       WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO payment_methods (organization_id, name, sort_order)
SELECT o.id, m.name, m.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Cash',         1),
  ('Check',        2),
  ('AMEX',         3),
  ('Credit Card',  4),
  ('ACH',          5),
  ('CC Terminal',  6),
  ('CashApp',      7),
  ('E-Check',      8),
  ('Write Off',    9),
  ('Trade',       10)
) AS m(name, sort_order)
ON CONFLICT (organization_id, name) DO NOTHING;

-- ---------- term_codes ----------
CREATE TABLE IF NOT EXISTS term_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  net_days integer NOT NULL DEFAULT 0,
  down_payment_percent numeric(5,2) NOT NULL DEFAULT 0,
  is_default boolean DEFAULT false,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE term_codes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY term_codes_select_members ON term_codes FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY term_codes_write_admins ON term_codes FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
       WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO term_codes (organization_id, name, net_days, down_payment_percent, is_default, sort_order)
SELECT o.id, t.name, t.net_days, t.down_pct, t.is_default, t.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Net 30',           30,  0::numeric, false, 1),
  ('Net 15',           15,  0::numeric, false, 2),
  ('COD',               0,  0::numeric, false, 3),
  ('60/40 - DEFAULT',   0, 60::numeric, true,  4),
  ('Net 60',           60,  0::numeric, false, 5),
  ('Due on receipt',    0,  0::numeric, false, 6),
  ('Net 45',           45,  0::numeric, false, 7)
) AS t(name, net_days, down_pct, is_default, sort_order)
ON CONFLICT (organization_id, name) DO NOTHING;

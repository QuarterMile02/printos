-- ============================================================
-- Migration 085: Seed standard print-shop chart of accounts
-- Applied: 2026-07-23
-- ============================================================
-- Creates the chart_of_accounts table if it does not yet exist
-- (it may have been created via the Supabase dashboard), then
-- inserts all 66 standard ShopVOX-style accounts.
-- Idempotent: skips any account whose number already exists for that org.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  number          text,
  type            text,
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Grants (required — Supabase no longer auto-grants)
GRANT SELECT                          ON public.chart_of_accounts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.chart_of_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.chart_of_accounts TO service_role;

-- RLS
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view chart_of_accounts"   ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Org admins can manage chart_of_accounts"  ON public.chart_of_accounts;

CREATE POLICY "Org members can view chart_of_accounts"
  ON public.chart_of_accounts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = chart_of_accounts.organization_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "Org admins can manage chart_of_accounts"
  ON public.chart_of_accounts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = chart_of_accounts.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: insert for every org, skip accounts whose number already exists
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO public.chart_of_accounts (organization_id, name, number, type, sort_order)
SELECT
  o.id,
  v.name,
  v.number,
  v.acct_type,
  v.srt
FROM public.organizations o
CROSS JOIN (VALUES
  -- ── INCOME ──────────────────────────────────────────────────────────────
  ( 100, '1000', 'Sales - Banners & Large Format',    'Income'),
  ( 110, '1001', 'Sales - Signs & Displays',          'Income'),
  ( 120, '1002', 'Sales - Vehicle Wraps',             'Income'),
  ( 130, '1003', 'Sales - Apparel & Promotional',     'Income'),
  ( 140, '1004', 'Sales - Digital Marketing',         'Income'),
  ( 150, '1005', 'Sales - Installation Services',     'Income'),
  ( 160, '1006', 'Sales - Design Services',           'Income'),
  ( 170, '1007', 'Sales - Rush Fees',                 'Income'),
  ( 180, '1008', 'Sales - Shipping & Handling',       'Income'),
  ( 190, '1009', 'Sales - Miscellaneous Income',      'Income'),
  -- ── COST OF GOODS SOLD ──────────────────────────────────────────────────
  ( 300, '2000', 'COGS - Materials',                  'Cost of Goods Sold'),
  ( 310, '2001', 'COGS - Substrates & Media',         'Cost of Goods Sold'),
  ( 320, '2002', 'COGS - Inks & Supplies',            'Cost of Goods Sold'),
  ( 330, '2003', 'COGS - Outsourced Printing',        'Cost of Goods Sold'),
  ( 340, '2004', 'COGS - Outsourced Installation',    'Cost of Goods Sold'),
  ( 350, '2005', 'COGS - Apparel Cost',               'Cost of Goods Sold'),
  ( 360, '2006', 'COGS - Promotional Products Cost',  'Cost of Goods Sold'),
  ( 370, '2007', 'COGS - Shipping Cost',              'Cost of Goods Sold'),
  ( 380, '2008', 'COGS - Design Cost (Outsourced)',   'Cost of Goods Sold'),
  -- ── EXPENSES ────────────────────────────────────────────────────────────
  ( 500, '3000', 'Payroll - Production',              'Expense'),
  ( 510, '3001', 'Payroll - Sales',                   'Expense'),
  ( 520, '3002', 'Payroll - Admin',                   'Expense'),
  ( 530, '3003', 'Payroll - Management',              'Expense'),
  ( 540, '3010', 'Equipment - Lease/Depreciation',    'Expense'),
  ( 550, '3011', 'Equipment - Maintenance & Repair',  'Expense'),
  ( 560, '3012', 'Equipment - Supplies',              'Expense'),
  ( 570, '3020', 'Facility - Rent',                   'Expense'),
  ( 580, '3021', 'Facility - Utilities',              'Expense'),
  ( 590, '3022', 'Facility - Insurance',              'Expense'),
  ( 600, '3030', 'Vehicle - Lease/Depreciation',      'Expense'),
  ( 610, '3031', 'Vehicle - Fuel',                    'Expense'),
  ( 620, '3032', 'Vehicle - Insurance & Maintenance', 'Expense'),
  ( 630, '3040', 'Marketing - Advertising',           'Expense'),
  ( 640, '3041', 'Marketing - Trade Shows',           'Expense'),
  ( 650, '3042', 'Marketing - Samples & Promos',      'Expense'),
  ( 660, '3050', 'Technology - Software Subscriptions','Expense'),
  ( 670, '3051', 'Technology - Internet & Phone',     'Expense'),
  ( 680, '3052', 'Technology - Hardware',             'Expense'),
  ( 690, '3060', 'Professional - Accounting',         'Expense'),
  ( 700, '3061', 'Professional - Legal',              'Expense'),
  ( 710, '3062', 'Professional - Consulting',         'Expense'),
  ( 720, '3070', 'Office - Supplies',                 'Expense'),
  ( 730, '3071', 'Office - Postage & Shipping',       'Expense'),
  ( 740, '3072', 'Office - Meals & Entertainment',    'Expense'),
  ( 750, '3080', 'Bank - Merchant Fees',              'Expense'),
  ( 760, '3081', 'Bank - Interest & Fees',            'Expense'),
  -- ── ASSETS ──────────────────────────────────────────────────────────────
  ( 900, '4000', 'Cash - Operating Account',          'Other Current Asset'),
  ( 910, '4001', 'Cash - Payroll Account',            'Other Current Asset'),
  ( 920, '4002', 'Accounts Receivable',               'Accounts Receivable'),
  ( 930, '4003', 'Inventory - Raw Materials',         'Other Current Asset'),
  ( 940, '4004', 'Inventory - Finished Goods',        'Other Current Asset'),
  ( 950, '4005', 'Prepaid Expenses',                  'Other Current Asset'),
  ( 960, '4010', 'Equipment - Large Format Printers', 'Other Current Asset'),
  ( 970, '4011', 'Equipment - CNC & Routing',         'Other Current Asset'),
  ( 980, '4012', 'Equipment - Vehicles & Wrapping',   'Other Current Asset'),
  ( 990, '4013', 'Equipment - Computers & Technology','Other Current Asset'),
  (1000, '4014', 'Accumulated Depreciation',          'Other Current Asset'),
  -- ── LIABILITIES ─────────────────────────────────────────────────────────
  (1100, '5000', 'Accounts Payable',                  'Expense'),
  (1110, '5001', 'Sales Tax Payable',                 'Expense'),
  (1120, '5002', 'Payroll Tax Payable',               'Expense'),
  (1130, '5003', 'Credit Cards Payable',              'Expense'),
  (1140, '5004', 'Equipment Loans',                   'Expense'),
  (1150, '5005', 'Line of Credit',                    'Expense'),
  -- ── EQUITY ──────────────────────────────────────────────────────────────
  (1200, '6000', 'Owner Equity',                      'Income'),
  (1210, '6001', 'Retained Earnings',                 'Income'),
  (1220, '6002', 'Owner Draw',                        'Expense')
) AS v(srt, number, name, acct_type)
WHERE NOT EXISTS (
  SELECT 1
  FROM   public.chart_of_accounts c
  WHERE  c.organization_id = o.id
    AND  c.number          = v.number
);

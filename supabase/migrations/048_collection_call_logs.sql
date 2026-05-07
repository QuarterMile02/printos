-- Migration 048: collection_call_logs — accounting log of every call
-- made to a customer about an overdue invoice. Powers the rebuilt
-- Collection Calls widget and the Payment Promise Tracker widget.

CREATE TABLE IF NOT EXISTS collection_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  logged_by uuid REFERENCES auth.users(id),
  outcome text NOT NULL,
  promise_date date,
  notes text,
  logged_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collection_logs_org ON collection_call_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_collection_logs_customer ON collection_call_logs(customer_id);

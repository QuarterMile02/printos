-- Migration 049: jobs table — add invoice link and proof workflow columns
-- needed by the dashboard alert strip pills 3 (Completed Not Invoiced)
-- and 4 (Proofs Past Deadline). Also adds proof_sent_at + completed_at
-- which the KPI summary widget already expects to exist.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proof_due_date timestamptz,
  ADD COLUMN IF NOT EXISTS proof_status text DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS proof_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_jobs_invoice_id
  ON jobs(invoice_id) WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_proof_due_date
  ON jobs(proof_due_date) WHERE proof_due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_completed_at
  ON jobs(completed_at) WHERE completed_at IS NOT NULL;

-- proof_status valid values (informational — not enforced by enum):
--   'not_started', 'in_progress', 'sent', 'approved', 'revision_requested'

-- Migration 091: Align tasks table schema with API layer
-- The tasks table was initially created in 066 with different column names,
-- constraint values, and FK targets. This migration brings it into alignment.

-- 1. Rename columns to match API expectations
ALTER TABLE public.tasks RENAME COLUMN organization_id TO org_id;
ALTER TABLE public.tasks RENAME COLUMN related_job_id TO job_id;

-- 2. Change due_date from timestamptz to DATE
ALTER TABLE public.tasks ALTER COLUMN due_date TYPE DATE USING due_date::DATE;

-- 3. Migrate existing status values to new set, then swap constraint
UPDATE public.tasks SET status = 'open' WHERE status = 'pending';
UPDATE public.tasks SET status = 'done' WHERE status = 'completed';
UPDATE public.tasks SET status = 'open' WHERE status = 'cancelled';

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('open', 'in_progress', 'done'));

-- 4. Migrate existing priority values and swap constraint
UPDATE public.tasks SET priority = 'medium' WHERE priority = 'normal';
UPDATE public.tasks SET priority = 'high'   WHERE priority = 'urgent';

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE public.tasks ALTER COLUMN priority SET DEFAULT 'medium';
ALTER TABLE public.tasks ADD CONSTRAINT tasks_priority_check
  CHECK (priority IN ('low', 'medium', 'high'));

-- 5. Re-target assigned_to and created_by FKs from auth.users → profiles
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_assigned_to_fkey;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_created_by_fkey;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 6. Add columns required by the spec that didn't exist in 066
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS so_id      UUID REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id)     ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS lead_id    UUID;

-- 7. Indexes for new columns (org index rebuilds after column rename)
DROP INDEX IF EXISTS idx_tasks_org;
CREATE INDEX IF NOT EXISTS idx_tasks_org     ON public.tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_tasks_job     ON public.tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_tasks_so      ON public.tasks(so_id);
CREATE INDEX IF NOT EXISTS idx_tasks_invoice ON public.tasks(invoice_id);

-- 8. Replace RLS policies (old ones referenced organization_id which is now org_id)
DROP POLICY IF EXISTS "tasks_self_view"   ON public.tasks;
DROP POLICY IF EXISTS "tasks_self_insert" ON public.tasks;
DROP POLICY IF EXISTS "tasks_self_update" ON public.tasks;
DROP POLICY IF EXISTS "tasks_self_delete" ON public.tasks;
DROP POLICY IF EXISTS "org_tasks"         ON public.tasks;

CREATE POLICY "org_tasks" ON public.tasks
  FOR ALL USING (
    org_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
  );

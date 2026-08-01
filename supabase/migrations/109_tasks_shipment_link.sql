-- ============================================================
-- Migration 109: Link tasks to shipments
-- Applied: 2026-08-01
-- ============================================================
--
-- Local/pickup shipping methods (shipping_methods.carrier IN ('local',
-- 'pickup')) don't go through EasyPost rate-shopping — instead they create
-- an assigned task for someone to do the delivery or hand off the pickup.
-- Reuses the existing tasks table/assignment pattern (already has job_id,
-- so_id, invoice_id) rather than the jobs table, since jobs.assigned_to has
-- no working UI anywhere in the app while tasks.assigned_to already does.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tasks_shipment ON public.tasks(shipment_id);

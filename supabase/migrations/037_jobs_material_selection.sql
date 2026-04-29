-- 037 — Material selection results on jobs
-- Stores the smart-material-engine output so production can see
-- which roll to load, which printer to use, 2-up opportunities,
-- material used sqft, and low-stock warnings.
--
-- Shape of jobs.material_selection (jsonb):
--   {
--     "line_items": [
--       {
--         "line_item_id": uuid,
--         "selected_material_id": uuid | null,
--         "selected_material_name": string | null,
--         "roll_width_inches": number | null,
--         "actual_print_width": number,
--         "actual_print_height": number,
--         "hem_allowance_applied": boolean,
--         "assigned_printer": "Epson" | "Swiss Q" | null,
--         "two_up_candidate": boolean,
--         "two_up_roll_width": number | null,
--         "material_used_sqft": number,
--         "low_stock_warning": boolean,
--         "low_stock_message": string | null,
--         "no_material_found": boolean,
--         "reason": string | null
--       }
--     ],
--     "computed_at": iso timestamp
--   }
--
-- assigned_printer is denormalized to the job for quick filtering on
-- the production board (e.g. "show me everything routed to Swiss Q").

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS material_selection jsonb,
  ADD COLUMN IF NOT EXISTS assigned_printer text;

CREATE INDEX IF NOT EXISTS jobs_assigned_printer_idx
  ON jobs (organization_id, assigned_printer)
  WHERE assigned_printer IS NOT NULL;

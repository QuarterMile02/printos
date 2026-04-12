-- PrintOS Workflow Templates Seed
-- Based on ShopVOX workflow capture April 6 2026
-- Run this in Supabase SQL Editor after getting org ID

-- First check your org ID
-- SELECT id, slug FROM organizations WHERE slug = 'quarter-mile-inc';

-- Replace 'YOUR_ORG_ID' with actual org ID from above query
DO $$
DECLARE
  org_id uuid;
  wf_digital_lam uuid;
  wf_digital uuid;
  wf_commercial uuid;
  wf_permit uuid;
  wf_install_illuminated uuid;
  wf_install_vehicle uuid;
  wf_install_only uuid;
BEGIN
  -- Get org ID
  SELECT id INTO org_id FROM organizations WHERE slug = 'quarter-mile-inc' LIMIT 1;
  
  IF org_id IS NULL THEN
    RAISE EXCEPTION 'Organization quarter-mile-inc not found';
  END IF;

  -- ── 1. DIGITAL PRINT WITH LAMINATE ──────────────────────────────────────
  INSERT INTO workflow_templates (organization_id, name, description, template_type, active)
  VALUES (org_id, 'Digital Print with Laminate', 
    'Full color digital print with laminate — vinyl decals, window graphics, vehicle graphics',
    'production', true)
  RETURNING id INTO wf_digital_lam;

  INSERT INTO workflow_stages (organization_id, workflow_template_id, name, sort_order, stage_phase, can_track_time) VALUES
    (org_id, wf_digital_lam, 'Customer Review',        1,  'pre_production', true),
    (org_id, wf_digital_lam, 'Design',                 2,  'pre_production', true),
    (org_id, wf_digital_lam, 'Upload Files to Server', 3,  'pre_production', true),
    (org_id, wf_digital_lam, 'File Prep',              4,  'pre_production', true),
    (org_id, wf_digital_lam, 'Reupload Files to Server',5, 'pre_production', true),
    (org_id, wf_digital_lam, 'Prepress / Rip/Print',   6,  'production',     true),
    (org_id, wf_digital_lam, 'Lam Prep / Laminate',    7,  'production',     true),
    (org_id, wf_digital_lam, 'Cutting',                8,  'production',     true),
    (org_id, wf_digital_lam, 'Quality Control',        9,  'production',     true),
    (org_id, wf_digital_lam, 'Call Customer / Pick or Delivery', 10, 'post_production', true);

  -- ── 2. DIGITAL PRINT (NO LAMINATE — DIRECT TO SUBSTRATE) ────────────────
  INSERT INTO workflow_templates (organization_id, name, description, template_type, active)
  VALUES (org_id, 'Digital Print',
    'Direct to substrate printing — coroplast, foam board, aluminum composite, acrylic',
    'production', true)
  RETURNING id INTO wf_digital;

  INSERT INTO workflow_stages (organization_id, workflow_template_id, name, sort_order, stage_phase, can_track_time) VALUES
    (org_id, wf_digital, 'Customer Review',         1,  'pre_production', true),
    (org_id, wf_digital, 'Design',                  2,  'pre_production', true),
    (org_id, wf_digital, 'Upload Files to Server',  3,  'pre_production', true),
    (org_id, wf_digital, 'File Prep',               4,  'pre_production', true),
    (org_id, wf_digital, 'Reupload Files to Server',5,  'pre_production', true),
    (org_id, wf_digital, 'Prepress / Rip/Print',    6,  'production',     true),
    (org_id, wf_digital, 'Cutting',                 7,  'production',     true),
    (org_id, wf_digital, 'Quality Control',         8,  'production',     true),
    (org_id, wf_digital, 'Call Customer / Pick up or Delivery', 9, 'post_production', true);

  -- ── 3. COMMERCIAL PRINT (OUTSOURCED) ────────────────────────────────────
  INSERT INTO workflow_templates (organization_id, name, description, template_type, active)
  VALUES (org_id, 'Commercial Print',
    'Outsourced commercial printing — business cards, flyers, brochures, postcards',
    'production', true)
  RETURNING id INTO wf_commercial;

  INSERT INTO workflow_stages (organization_id, workflow_template_id, name, sort_order, stage_phase, can_track_time) VALUES
    (org_id, wf_commercial, 'Customer Review',          1, 'pre_production', true),
    (org_id, wf_commercial, 'Design',                   2, 'pre_production', true),
    (org_id, wf_commercial, 'Upload Files to Server',   3, 'pre_production', true),
    (org_id, wf_commercial, 'PrePress',                 4, 'pre_production', true),
    (org_id, wf_commercial, 'Reupload Files to Server', 5, 'pre_production', true),
    (org_id, wf_commercial, 'Call Customer Pick Up / Delivery', 6, 'post_production', true);

  -- ── 4. SIGN PERMIT ───────────────────────────────────────────────────────
  INSERT INTO workflow_templates (organization_id, name, description, template_type, active)
  VALUES (org_id, 'Sign Permit',
    'City permit process for wall-attached, illuminated, and monument signs',
    'production', true)
  RETURNING id INTO wf_permit;

  INSERT INTO workflow_stages (organization_id, workflow_template_id, name, sort_order, stage_phase, can_track_time) VALUES
    (org_id, wf_permit, 'Design Permit',                      1, 'pre_production',  true),
    (org_id, wf_permit, 'Get Customer Info for Application',  2, 'pre_production',  true),
    (org_id, wf_permit, 'Get Signatures',                     3, 'pre_production',  true),
    (org_id, wf_permit, 'Send Application to Building Department', 4, 'pre_production', true),
    (org_id, wf_permit, 'Get Application Approved',           5, 'pre_production',  true),
    (org_id, wf_permit, 'Pay Permit Online',                  6, 'post_production', true),
    (org_id, wf_permit, 'Call Customer / Schedule Installation', 7, 'post_production', true);

  -- ── 5. INSTALLATION — ILLUMINATED SIGNS ──────────────────────────────────
  INSERT INTO workflow_templates (organization_id, name, description, template_type, active)
  VALUES (org_id, 'Installation — Illuminated Signs',
    'Installation workflow for channel letters, cabinet signs, monument signs, and LED signs',
    'production', true)
  RETURNING id INTO wf_install_illuminated;

  INSERT INTO workflow_stages (organization_id, workflow_template_id, name, sort_order, stage_phase, can_track_time) VALUES
    (org_id, wf_install_illuminated, 'Quality Control',                 1, 'post_production', true),
    (org_id, wf_install_illuminated, 'Pre-Install Checklist / Packaging', 2, 'post_production', true),
    (org_id, wf_install_illuminated, 'Call Customer / Schedule Install', 3, 'post_production', true),
    (org_id, wf_install_illuminated, 'Site Prep / Rigging',             4, 'post_production', true),
    (org_id, wf_install_illuminated, 'Install Sign',                    5, 'post_production', true),
    (org_id, wf_install_illuminated, 'Site Pick Up',                    6, 'post_production', true),
    (org_id, wf_install_illuminated, 'Upload Completion Photos',        7, 'post_production', true);

  -- ── 6. INSTALLATION — VEHICLE GRAPHICS ───────────────────────────────────
  INSERT INTO workflow_templates (organization_id, name, description, template_type, active)
  VALUES (org_id, 'Installation — Vehicle Graphics',
    'Installation workflow for vehicle wraps, fleet decals, and vehicle graphics',
    'production', true)
  RETURNING id INTO wf_install_vehicle;

  INSERT INTO workflow_stages (organization_id, workflow_template_id, name, sort_order, stage_phase, can_track_time) VALUES
    (org_id, wf_install_vehicle, 'Schedule Installation',          1, 'pre_production',  true),
    (org_id, wf_install_vehicle, 'QC / Pack / Prepare for Transport', 2, 'post_production', true),
    (org_id, wf_install_vehicle, 'Install',                        3, 'post_production', true),
    (org_id, wf_install_vehicle, 'Site Pick Up',                   4, 'post_production', true),
    (org_id, wf_install_vehicle, 'Completion Photos',              5, 'post_production', true);

  -- ── 7. INSTALLATION ONLY (GENERIC) ───────────────────────────────────────
  INSERT INTO workflow_templates (organization_id, name, description, template_type, active)
  VALUES (org_id, 'Installation Only',
    'Generic installation — vinyl, decals, window graphics, banners',
    'production', true)
  RETURNING id INTO wf_install_only;

  INSERT INTO workflow_stages (organization_id, workflow_template_id, name, sort_order, stage_phase, can_track_time) VALUES
    (org_id, wf_install_only, 'Schedule Installation',           1, 'pre_production',  true),
    (org_id, wf_install_only, 'QC / Pack / Prepare for Transport', 2, 'post_production', true),
    (org_id, wf_install_only, 'Install',                         3, 'post_production', true),
    (org_id, wf_install_only, 'Site Pick Up',                    4, 'post_production', true),
    (org_id, wf_install_only, 'Completion Photos',               5, 'post_production', true);

  RAISE NOTICE 'Workflow seed complete — 7 templates created for org %', org_id;
END $$;

SELECT 
  wt.name as workflow,
  count(ws.id) as stages
FROM workflow_templates wt
LEFT JOIN workflow_stages ws ON ws.workflow_template_id = wt.id
GROUP BY wt.name
ORDER BY wt.name;

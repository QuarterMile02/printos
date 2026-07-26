-- RLS policies for saved_views
-- Run in Supabase SQL Editor — do NOT execute via app code.
--
-- Role source: organization_members.role (org_role enum)
-- shared_with_roles  is text[]  → cast om.role::text for comparison
-- shared_with_user_ids is uuid[] → ARRAY[auth.uid()] needs no cast

-- SELECT: own views + non-personal views shared with this user by role or user_id
CREATE POLICY "saved_views_select" ON saved_views
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
    AND (
      created_by = auth.uid()
      OR (
        view_type != 'personal'
        AND (
          shared_with_user_ids @> ARRAY[auth.uid()]
          OR EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.user_id = auth.uid()
              AND om.organization_id = saved_views.organization_id
              AND saved_views.shared_with_roles @> ARRAY[om.role::text]
          )
        )
      )
    )
  );

-- INSERT: personal → role != 'viewer'; collaborative/locked → role IN ('owner','admin')
DROP POLICY IF EXISTS "saved_views_insert" ON saved_views;
CREATE POLICY "saved_views_insert" ON saved_views
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND (
      (view_type = 'personal' AND EXISTS (
        SELECT 1 FROM organization_members
        WHERE user_id = auth.uid()
          AND organization_id = saved_views.organization_id
          AND role != 'viewer'
      ))
      OR (view_type IN ('collaborative', 'locked') AND EXISTS (
        SELECT 1 FROM organization_members
        WHERE user_id = auth.uid()
          AND organization_id = saved_views.organization_id
          AND role IN ('owner', 'admin')
      ))
    )
  );

-- UPDATE: creator of any view, OR any user with access to a collaborative view
CREATE POLICY "saved_views_update" ON saved_views
  FOR UPDATE USING (
    created_by = auth.uid()
    OR (
      view_type = 'collaborative'
      AND organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
      )
      AND (
        shared_with_user_ids @> ARRAY[auth.uid()]
        OR EXISTS (
          SELECT 1 FROM organization_members om
          WHERE om.user_id = auth.uid()
            AND om.organization_id = saved_views.organization_id
            AND saved_views.shared_with_roles @> ARRAY[om.role::text]
        )
      )
    )
  );

-- DELETE: creator only
CREATE POLICY "saved_views_delete" ON saved_views
  FOR DELETE USING (
    created_by = auth.uid()
    AND organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

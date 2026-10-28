-- Regenerating an itinerary deletes the trip's days, then inserts new ones.
-- Production never had a days DELETE policy, so that delete removed 0 rows
-- with no error and every regenerate left the old (emptied) days beside the
-- new ones. Staging had one, keyed on created_by, which the collab hardening
-- (20261009000001) moved off for every other owner right. Same rule as the
-- days UPDATE policy: edit members or the owner.
-- SUPERSEDED by 20261028000005 (owner-only; replace_trip_days is DEFINER).
DROP POLICY IF EXISTS "Edit members can delete days" ON days;
CREATE POLICY "Edit members can delete days" ON days FOR DELETE TO authenticated
  USING (
    auth.uid() IN (SELECT tm.user_id FROM trip_members tm WHERE tm.trip_id = days.trip_id AND tm.role = 'edit')
    OR EXISTS (SELECT 1 FROM trips t WHERE t.id = days.trip_id AND t.owner_id = auth.uid())
  );

-- ============================================================================
-- Phase 0b · 04 — is_trip_member() helper + non-recursive RLS
-- Fixes the R3 footgun: never write a SELECT policy ON trip_members that
-- subqueries trip_members (recursion / empty-result / per-row realtime cost).
-- Use this SECURITY DEFINER helper (bypasses RLS for the membership check).
-- Policies use DROP … IF EXISTS + CREATE for idempotent re-runs.
-- NOTE: RLS for the pre-existing `comments`/`reactions` tables is deferred until
-- the pg_dump reveals their current policies (see 01 stub) — do not guess here.
-- ============================================================================

CREATE OR REPLACE FUNCTION is_trip_member(p_trip uuid, p_uid uuid)
  RETURNS boolean
  LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM trip_members WHERE trip_id = p_trip AND user_id = p_uid
    );
  $$;

-- --- trip_members: co-member visibility (avatars/attribution) ----------------
DROP POLICY IF EXISTS "members read co-members" ON trip_members;
CREATE POLICY "members read co-members" ON trip_members
  FOR SELECT TO authenticated
  USING (is_trip_member(trip_id, auth.uid()));
-- (INSERT stays restricted — membership is added only via the accept_invite
--  SECURITY DEFINER RPC. DELETE policy already exists from 2026-07-13.)

-- --- activity_log: members read; author inserts own rows ----------------------
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read activity" ON activity_log;
CREATE POLICY "members read activity" ON activity_log
  FOR SELECT TO authenticated
  USING (is_trip_member(trip_id, auth.uid()));
DROP POLICY IF EXISTS "author writes activity" ON activity_log;
CREATE POLICY "author writes activity" ON activity_log
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      is_trip_member(trip_id, auth.uid())
      -- owner fallback: LEGACY solo trips created before trip_members was wired
      -- up may lack a self-membership row; without this, their activity_log
      -- inserts would be denied and "solo trips log too" would silently break.
      OR EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_id AND t.created_by = auth.uid())
    )
  );

-- --- trip_preferences: member read, self write -------------------------------
ALTER TABLE trip_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read prefs" ON trip_preferences;
CREATE POLICY "members read prefs" ON trip_preferences
  FOR SELECT TO authenticated USING (is_trip_member(trip_id, auth.uid()));
DROP POLICY IF EXISTS "self writes prefs" ON trip_preferences;
CREATE POLICY "self writes prefs" ON trip_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND is_trip_member(trip_id, auth.uid()));

-- --- trip_read_state: self only ----------------------------------------------
ALTER TABLE trip_read_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "self read_state" ON trip_read_state;
CREATE POLICY "self read_state" ON trip_read_state
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- --- notification_prefs: self only -------------------------------------------
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "self notif_prefs" ON notification_prefs;
CREATE POLICY "self notif_prefs" ON notification_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- --- polls: members read; members create/update ------------------------------
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read polls" ON polls;
CREATE POLICY "members read polls" ON polls
  FOR SELECT TO authenticated USING (is_trip_member(trip_id, auth.uid()));
DROP POLICY IF EXISTS "members create polls" ON polls;
CREATE POLICY "members create polls" ON polls
  FOR INSERT TO authenticated
  WITH CHECK (is_trip_member(trip_id, auth.uid()));
DROP POLICY IF EXISTS "members update polls" ON polls;
CREATE POLICY "members update polls" ON polls
  FOR UPDATE TO authenticated
  USING (is_trip_member(trip_id, auth.uid()))
  WITH CHECK (is_trip_member(trip_id, auth.uid()));

-- --- poll_votes: members read; self write ------------------------------------
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read votes" ON poll_votes;
CREATE POLICY "members read votes" ON poll_votes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM polls p
                 WHERE p.id = poll_votes.poll_id
                   AND is_trip_member(p.trip_id, auth.uid())));
DROP POLICY IF EXISTS "self writes votes" ON poll_votes;
CREATE POLICY "self writes votes" ON poll_votes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- --- service-role full access (matches existing convention; service_role also
--     bypasses RLS, so this is belt-and-suspenders for edge functions) ---------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activity_log','trip_preferences','trip_read_state','notification_prefs','polls','poll_votes'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "Service role full access" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

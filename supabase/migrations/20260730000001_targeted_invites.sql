-- ============================================================================
-- Co-traveller invites · account-targeted invites (hybrid with invite_links)
-- Adds a `trip_invites` table for invite-by-username/email + an in-app pending
-- surface, alongside the existing link-based `invite_links` flow.
--
-- Conventions mirror the Phase-1 collab RPCs (20260721000005..0007):
--   SECURITY DEFINER SET search_path = public · is_trip_member() for member
--   gating · owner_id for owner checks · capacity cap 8 · P0001 error codes ·
--   GRANT EXECUTE TO authenticated. All writes go through these RPCs — no direct
--   INSERT/UPDATE grants on the table.
-- ============================================================================

-- --- Table ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  inviter_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invitee_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'edit',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

-- At most one live invite per (trip, invitee). Resolved invites (accepted/
-- declined/cancelled) don't block a fresh re-invite.
CREATE UNIQUE INDEX IF NOT EXISTS trip_invites_one_pending
  ON trip_invites (trip_id, invitee_user_id)
  WHERE status = 'pending';

-- Fast lookup for the invitee's Home banner.
CREATE INDEX IF NOT EXISTS trip_invites_invitee_pending
  ON trip_invites (invitee_user_id)
  WHERE status = 'pending';

-- --- RLS --------------------------------------------------------------------
-- Reads: the invitee sees their own rows; trip members see the trip's rows
-- (for the pending roster in MembersSheet). Writes are RPC-only (no policies).
ALTER TABLE trip_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invitee reads own invites" ON trip_invites;
CREATE POLICY "invitee reads own invites" ON trip_invites
  FOR SELECT TO authenticated
  USING (invitee_user_id = auth.uid());

DROP POLICY IF EXISTS "members read trip invites" ON trip_invites;
CREATE POLICY "members read trip invites" ON trip_invites
  FOR SELECT TO authenticated
  USING (is_trip_member(trip_id, auth.uid()));

DROP POLICY IF EXISTS "Service role full access" ON trip_invites;
CREATE POLICY "Service role full access" ON trip_invites
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- --- invite_user_by_handle ---------------------------------------------------
-- Any trip MEMBER can invite (mirrors create_or_get_invite_link). Resolves the
-- target by exact (case-insensitive) username OR email. Capacity counts current
-- members + live pending invites against the cap of 8.
CREATE OR REPLACE FUNCTION invite_user_by_handle(p_trip uuid, p_handle text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target uuid;
  v_username text;
  v_existing uuid;
  v_count int;
  v_max int := 8;
  v_invite uuid;
BEGIN
  IF NOT is_trip_member(p_trip, auth.uid()) THEN
    RAISE EXCEPTION 'not_a_member' USING errcode = 'P0001';
  END IF;

  SELECT id, username INTO v_target, v_username
    FROM profiles
   WHERE lower(username) = lower(trim(p_handle))
      OR lower(email) = lower(trim(p_handle))
   LIMIT 1;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'user_not_found' USING errcode = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM trip_members WHERE trip_id = p_trip AND user_id = v_target) THEN
    RAISE EXCEPTION 'already_member' USING errcode = 'P0001';
  END IF;

  -- Reuse an existing live invite rather than erroring, so a double-tap is a no-op.
  SELECT id INTO v_existing
    FROM trip_invites
   WHERE trip_id = p_trip AND invitee_user_id = v_target AND status = 'pending'
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN json_build_object('invite_id', v_existing, 'username', v_username, 'already_invited', true);
  END IF;

  SELECT (SELECT count(*) FROM trip_members WHERE trip_id = p_trip)
       + (SELECT count(*) FROM trip_invites WHERE trip_id = p_trip AND status = 'pending')
    INTO v_count;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'trip_full' USING errcode = 'P0001';
  END IF;

  INSERT INTO trip_invites (trip_id, inviter_id, invitee_user_id, role)
    VALUES (p_trip, auth.uid(), v_target, 'edit')
    RETURNING id INTO v_invite;

  RETURN json_build_object('invite_id', v_invite, 'username', v_username, 'already_invited', false);
END $$;
GRANT EXECUTE ON FUNCTION invite_user_by_handle(uuid, text) TO authenticated;

-- --- list_pending_invites ----------------------------------------------------
-- The caller's own pending invites, enriched with trip + inviter info. SECURITY
-- DEFINER so a not-yet-member can read minimal trip details (mirrors
-- get_invite_preview). Returns a JSON array (empty array if none).
CREATE OR REPLACE FUNCTION list_pending_invites()
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN COALESCE((
    SELECT json_agg(row ORDER BY created_at DESC)
    FROM (
      SELECT
        i.id            AS invite_id,
        i.trip_id       AS trip_id,
        t.name          AS trip_name,
        t.destination   AS destination,
        t.start_date    AS start_date,
        t.end_date      AS end_date,
        i.created_at     AS created_at,
        (SELECT count(*) FROM trip_members m WHERE m.trip_id = t.id) AS member_count,
        (SELECT p.username FROM profiles p WHERE p.id = i.inviter_id) AS inviter
      FROM trip_invites i
      JOIN trips t ON t.id = i.trip_id
      WHERE i.invitee_user_id = auth.uid() AND i.status = 'pending'
    ) row
  ), '[]'::json);
END $$;
GRANT EXECUTE ON FUNCTION list_pending_invites() TO authenticated;

-- --- respond_invite ----------------------------------------------------------
-- The invitee accepts or declines their own pending invite. Accept re-checks the
-- capacity cap + inviter-still-member (same guards as accept_invite) and inserts
-- the trip_members row. Returns the trip_id on accept, NULL on decline.
CREATE OR REPLACE FUNCTION respond_invite(p_invite uuid, p_accept boolean)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip uuid;
  v_role text;
  v_inviter uuid;
  v_count int;
  v_max int := 8;
BEGIN
  SELECT trip_id, role, inviter_id INTO v_trip, v_role, v_inviter
    FROM trip_invites
   WHERE id = p_invite AND invitee_user_id = auth.uid() AND status = 'pending';
  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'invalid_invite' USING errcode = 'P0001';
  END IF;

  IF NOT p_accept THEN
    UPDATE trip_invites SET status = 'declined', responded_at = now() WHERE id = p_invite;
    RETURN NULL;
  END IF;

  -- inviter must still be a member of the trip.
  IF v_inviter IS NULL
     OR NOT EXISTS (SELECT 1 FROM trip_members WHERE trip_id = v_trip AND user_id = v_inviter) THEN
    RAISE EXCEPTION 'inviter_left' USING errcode = 'P0001';
  END IF;

  SELECT count(*) INTO v_count FROM trip_members WHERE trip_id = v_trip;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'trip_full' USING errcode = 'P0001';
  END IF;

  INSERT INTO trip_members (trip_id, user_id, role)
    VALUES (v_trip, auth.uid(), COALESCE(v_role, 'edit'))
    ON CONFLICT (trip_id, user_id) DO NOTHING;

  UPDATE trip_invites SET status = 'accepted', responded_at = now() WHERE id = p_invite;
  RETURN v_trip;
END $$;
GRANT EXECUTE ON FUNCTION respond_invite(uuid, boolean) TO authenticated;

-- --- cancel_invite -----------------------------------------------------------
-- The trip owner or the original inviter cancels a pending invite.
CREATE OR REPLACE FUNCTION cancel_invite(p_invite uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_trip uuid; v_inviter uuid;
BEGIN
  SELECT trip_id, inviter_id INTO v_trip, v_inviter
    FROM trip_invites
   WHERE id = p_invite AND status = 'pending';
  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'invalid_invite' USING errcode = 'P0001';
  END IF;

  IF v_inviter <> auth.uid()
     AND NOT EXISTS (SELECT 1 FROM trips WHERE id = v_trip AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_allowed' USING errcode = 'P0001';
  END IF;

  UPDATE trip_invites SET status = 'cancelled', responded_at = now() WHERE id = p_invite;
END $$;
GRANT EXECUTE ON FUNCTION cancel_invite(uuid) TO authenticated;

-- accept_invite v2: joining via a link also retires any PENDING targeted
-- invite for the same (trip, user). The invite_member email now lands on
-- /join/<token> (the polished preview flow) — without this sweep, accepting
-- there would leave the targeted invite stuck pending forever (ghost row in
-- the owner's members sheet + a stale banner on the invitee's Home).

CREATE OR REPLACE FUNCTION accept_invite(p_token text)
  RETURNS uuid                                   -- returns trip_id
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip uuid;
  v_role text;
  v_creator uuid;
  v_count int;
  v_max int := 8;                                -- max members per trip (confirmed 2026-07-20)
BEGIN
  SELECT trip_id, role, created_by
    INTO v_trip, v_role, v_creator
    FROM invite_links
   WHERE token = p_token
     AND (expires_at IS NULL OR expires_at > now());
  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'invalid_or_expired' USING errcode = 'P0001';
  END IF;

  -- inviter must still be a member of the trip.
  IF NOT EXISTS (SELECT 1 FROM trip_members WHERE trip_id = v_trip AND user_id = v_creator) THEN
    RAISE EXCEPTION 'inviter_left' USING errcode = 'P0001';
  END IF;

  -- capacity guard
  SELECT count(*) INTO v_count FROM trip_members WHERE trip_id = v_trip;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'trip_full' USING errcode = 'P0001';
  END IF;

  INSERT INTO trip_members (trip_id, user_id, role)
    VALUES (v_trip, auth.uid(), COALESCE(v_role, 'edit'))
    ON CONFLICT (trip_id, user_id) DO NOTHING;

  -- Sweep: a pending TARGETED invite for this user+trip is now fulfilled.
  UPDATE trip_invites
     SET status = 'accepted'
   WHERE trip_id = v_trip
     AND invitee_user_id = auth.uid()
     AND status = 'pending';

  RETURN v_trip;
END $$;

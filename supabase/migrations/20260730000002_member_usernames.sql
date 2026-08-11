-- ============================================================================
-- Co-traveller member/invite name visibility.
--
-- profiles RLS (20260527000002) restricts SELECT to the caller's own row (to
-- protect email / credits / stripe_customer_id / is_admin). As a result, the
-- client-side `trip_members`/`trip_invites` embeds of `profiles(username)`
-- return null for OTHER members, so the members UI shows "Traveler" instead of
-- the real name.
--
-- These SECURITY DEFINER RPCs expose ONLY the username (never email/credits) to
-- fellow trip members, gated by is_trip_member(). Same conventions as the other
-- collab RPCs (SET search_path, P0001 codes, GRANT to authenticated).
-- ============================================================================

-- Members of a trip, enriched with username. Shape mirrors the previous
-- fetchMembers() embed ({ user_id, role, joined_at, profiles: { id, username } })
-- so no other frontend changes are needed.
CREATE OR REPLACE FUNCTION list_trip_members(p_trip uuid)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_trip_member(p_trip, auth.uid()) THEN
    RAISE EXCEPTION 'not_a_member' USING errcode = 'P0001';
  END IF;
  RETURN COALESCE((
    SELECT json_agg(
      json_build_object(
        'user_id', m.user_id,
        'role', m.role,
        'joined_at', m.joined_at,
        'profiles', json_build_object('id', p.id, 'username', p.username)
      )
      ORDER BY m.joined_at
    )
    FROM trip_members m
    LEFT JOIN profiles p ON p.id = m.user_id
    WHERE m.trip_id = p_trip
  ), '[]'::json);
END $$;
GRANT EXECUTE ON FUNCTION list_trip_members(uuid) TO authenticated;

-- Pending targeted invites for a trip, enriched with the invitee's username.
-- Shape mirrors the previous fetchTripInvites() embed
-- ({ id, invitee_user_id, status, profiles: { username } }).
CREATE OR REPLACE FUNCTION list_trip_invites(p_trip uuid)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_trip_member(p_trip, auth.uid()) THEN
    RAISE EXCEPTION 'not_a_member' USING errcode = 'P0001';
  END IF;
  RETURN COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', i.id,
        'invitee_user_id', i.invitee_user_id,
        'status', i.status,
        'profiles', json_build_object('username', p.username)
      )
      ORDER BY i.created_at
    )
    FROM trip_invites i
    LEFT JOIN profiles p ON p.id = i.invitee_user_id
    WHERE i.trip_id = p_trip AND i.status = 'pending'
  ), '[]'::json);
END $$;
GRANT EXECUTE ON FUNCTION list_trip_invites(uuid) TO authenticated;

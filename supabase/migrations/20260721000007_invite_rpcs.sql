-- ============================================================================
-- Phase 1 · invite-link RPCs
-- SECURITY DEFINER so the client never touches invite_links directly (no need to
-- loosen its RLS). Creating a link is allowed for any trip MEMBER (friendlier for
-- adoption; accept_invite already trust-checks the inviter is still a member).
-- Revoke is OWNER-only. get_invite_preview lets a not-yet-member see minimal trip
-- info on the join screen.
-- ============================================================================

-- Create (or reuse an existing unexpired) invite link for a trip. Returns token.
CREATE OR REPLACE FUNCTION create_or_get_invite_link(p_trip uuid)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token text;
BEGIN
  IF NOT is_trip_member(p_trip, auth.uid()) THEN
    RAISE EXCEPTION 'not_a_member' USING errcode = 'P0001';
  END IF;
  SELECT token INTO v_token
    FROM invite_links
   WHERE trip_id = p_trip AND (expires_at IS NULL OR expires_at > now())
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_token IS NULL THEN
    INSERT INTO invite_links (trip_id, created_by, role)
      VALUES (p_trip, auth.uid(), 'edit')
      RETURNING token INTO v_token;
  END IF;
  RETURN v_token;
END $$;
GRANT EXECUTE ON FUNCTION create_or_get_invite_link(uuid) TO authenticated;

-- Revoke all invite links for a trip (owner only).
CREATE OR REPLACE FUNCTION revoke_invite_link(p_trip uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id = p_trip AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING errcode = 'P0001';
  END IF;
  DELETE FROM invite_links WHERE trip_id = p_trip;
END $$;
GRANT EXECUTE ON FUNCTION revoke_invite_link(uuid) TO authenticated;

-- Minimal preview for the join screen — safe for a not-yet-member to call.
CREATE OR REPLACE FUNCTION get_invite_preview(p_token text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_trip uuid; v_creator uuid;
BEGIN
  SELECT trip_id, created_by INTO v_trip, v_creator
    FROM invite_links
   WHERE token = p_token AND (expires_at IS NULL OR expires_at > now());
  IF v_trip IS NULL THEN
    RETURN json_build_object('valid', false);
  END IF;
  RETURN (
    SELECT json_build_object(
      'valid', true,
      'trip_id', t.id,
      'trip_name', t.name,
      'destination', t.destination,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'member_count', (SELECT count(*) FROM trip_members m WHERE m.trip_id = t.id),
      'inviter', (SELECT p.username FROM profiles p WHERE p.id = v_creator)
    )
    FROM trips t WHERE t.id = v_trip
  );
END $$;
GRANT EXECUTE ON FUNCTION get_invite_preview(text) TO authenticated;

-- ============================================================================
-- Phase 1 · 06 — accept_invite() RPC
-- SECURITY DEFINER so acceptance is a guarded self-insert — we never loosen
-- trip_members INSERT to arbitrary rows. Param is `text` (opaque token from
-- /join/:token), not uuid. Enforces token validity, inviter-still-member, and a
-- max-members cap (8).
-- ============================================================================

-- Defensive: the ON CONFLICT below needs a unique key on (trip_id, user_id).
-- trip_members is untracked (no migration), so we can't assume it exists —
-- create it idempotently. Redundant if one already exists (harmless); will fail
-- only if duplicate memberships already exist (pathological — investigate).
CREATE UNIQUE INDEX IF NOT EXISTS trip_members_trip_user_uidx
  ON trip_members (trip_id, user_id);

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
  -- ⚠️ DECISION: this means a reusable link dies if the owner leaves (owner invites
  -- 3, leaves, the other 2 links break). Intended for v1 (invites are trust-scoped
  -- to an active member). If undesired, relax to "any current member exists".
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

  RETURN v_trip;
END $$;

-- Callable by authenticated users (the SECURITY DEFINER body does the gating).
GRANT EXECUTE ON FUNCTION accept_invite(text) TO authenticated;

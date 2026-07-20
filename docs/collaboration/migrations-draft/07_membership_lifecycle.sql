-- ============================================================================
-- Phase 1 · 07 — Membership lifecycle (transferable ownership, leave, remove)
-- Decisions 2026-07-21 (documentation.md §3 "Membership lifecycle").
--   • Owner can leave, but must transfer ownership first.
--   • Last member leaves → trip deleted.
--   • Remove/leave deletes that member's poll votes (+ vote-notes); everything
--     else (messages, edits, funded credits, polls they created) stays.
--   • Access revoked instantly (trip_members row gone → is_trip_member false).
-- ============================================================================

-- --- Transferable ownership -------------------------------------------------
-- created_by stays immutable (historical); owner_id is the movable owner.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES profiles(id);
UPDATE trips SET owner_id = created_by WHERE owner_id IS NULL;
-- Enforce not-null only if every row backfilled (some legacy trips may have a
-- null created_by — check first; uncomment once clean):
-- ALTER TABLE trips ALTER COLUMN owner_id SET NOT NULL;

-- ⚠️ RLS REPOINT (needs the pg_dump): the existing owner-only policies on `trips`
-- (and invite create/revoke) key off `created_by`. Repoint them to `owner_id` so
-- ownership actually transfers. Their exact names/definitions are unknown until
-- the prod dump — do that repoint alongside `01`. The RPCs below are
-- SECURITY DEFINER and check owner_id internally, so they are correct regardless.

-- --- Ownership transfer ------------------------------------------------------
CREATE OR REPLACE FUNCTION transfer_ownership(p_trip uuid, p_new_owner uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id = p_trip AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING errcode = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trip_members WHERE trip_id = p_trip AND user_id = p_new_owner) THEN
    RAISE EXCEPTION 'new_owner_not_member' USING errcode = 'P0001';
  END IF;
  UPDATE trips SET owner_id = p_new_owner WHERE id = p_trip;
END $$;
GRANT EXECUTE ON FUNCTION transfer_ownership(uuid, uuid) TO authenticated;

-- --- Shared cleanup: delete a member's poll votes + vote-notes for one trip ---
CREATE OR REPLACE FUNCTION _cleanup_member_polls(p_trip uuid, p_user uuid)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM poll_votes
   WHERE user_id = p_user
     AND poll_id IN (SELECT id FROM polls WHERE trip_id = p_trip);
  DELETE FROM comments
   WHERE entity_type = 'poll' AND user_id = p_user
     AND entity_id IN (SELECT id FROM polls WHERE trip_id = p_trip);
$$;

-- --- Owner removes a member --------------------------------------------------
CREATE OR REPLACE FUNCTION remove_member(p_trip uuid, p_user uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id = p_trip AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING errcode = 'P0001';
  END IF;
  IF p_user = auth.uid() THEN
    RAISE EXCEPTION 'use_leave_trip' USING errcode = 'P0001';  -- owner uses leave_trip
  END IF;
  PERFORM _cleanup_member_polls(p_trip, p_user);
  DELETE FROM trip_members WHERE trip_id = p_trip AND user_id = p_user;
END $$;
GRANT EXECUTE ON FUNCTION remove_member(uuid, uuid) TO authenticated;

-- --- Member (or owner) leaves ------------------------------------------------
CREATE OR REPLACE FUNCTION leave_trip(p_trip uuid)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_owner boolean; v_members int;
BEGIN
  SELECT (owner_id = auth.uid()) INTO v_is_owner FROM trips WHERE id = p_trip;
  IF v_is_owner IS NULL THEN RAISE EXCEPTION 'not_a_trip' USING errcode = 'P0001'; END IF;
  SELECT count(*) INTO v_members FROM trip_members WHERE trip_id = p_trip;

  IF v_is_owner AND v_members > 1 THEN
    -- must hand off first; UI opens the "choose new owner" picker
    RAISE EXCEPTION 'transfer_ownership_first' USING errcode = 'P0001';
  END IF;

  IF v_members <= 1 THEN
    -- last member leaving → delete the trip (dependent rows cascade via FKs;
    -- VERIFY every collab table FK to trips(id) is ON DELETE CASCADE in the dump)
    DELETE FROM trips WHERE id = p_trip;
    RETURN 'trip_deleted';
  END IF;

  PERFORM _cleanup_member_polls(p_trip, auth.uid());
  DELETE FROM trip_members WHERE trip_id = p_trip AND user_id = auth.uid();
  RETURN 'left';
END $$;
GRANT EXECUTE ON FUNCTION leave_trip(uuid) TO authenticated;

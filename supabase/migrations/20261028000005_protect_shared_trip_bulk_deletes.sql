-- ============================================================================
-- Protect a shared trip's itinerary from bulk deletes by co-members
-- ============================================================================
-- The Android APK runs the web client it was built with until a Play update,
-- and builds from before 2026-10-08 have no version gate (they never read
-- app_config.min_client_build). Their Home "Delete" runs four client-side
-- deletes:
--   activities .in("day_id", <every day of the trip>)
--   days       .eq("trip_id", …)
--   trip_members, trips
-- and their regenerate / itinerary save use the same first two steps. Run by
-- a CO-MEMBER of a shared trip, the last two are refused (owner-only since
-- 20261009000001) but the first two succeed: activities through "Edit members
-- can delete activities" (schema.sql), days through "Edit members can delete
-- days" (20261028000001). One tap wiped the itinerary for every traveller.
--
-- The current web client never deletes like that: trips go through
-- delete_trip / leave_trip (SECURITY DEFINER, rows cascade), itineraries
-- through replace_trip_days, and every activity delete it makes (chat v2
-- update_day, v3 apply_activity_ops, feed undo, remove/replace hotel) touches
-- ONE day. So this migration closes the old path without touching the new:
--
-- 1. days DELETE and INSERT become owner-only. replace_trip_days was the only
--    reason edit members needed them, and it becomes SECURITY DEFINER (2) so
--    it no longer depends on either policy. INSERT matters as much as DELETE:
--    the old client's co-member regenerate deletes (now refused), ignores the
--    error, then inserts the new days — which would land BESIDE the old ones
--    and leave the shared trip showing a mix of two plans.
-- 2. replace_trip_days → SECURITY DEFINER. It already refuses anyone without
--    an 'edit' trip_members row before writing; that check is now the gate,
--    and every write is scoped to p_trip. Re-created here (not just ALTERed)
--    so this file is the function's source of record.
-- 3. activities: a statement-level AFTER DELETE trigger refuses (42501,
--    'bulk_activity_delete_owner_only') a single statement by a signed-in
--    caller that removes activities from MORE THAN ONE day when any of those
--    days belongs to a trip the caller does not own. RLS cannot express "how
--    many rows did this statement touch"; a transition table can.
--
--    Cascades are unaffected: deleting days (delete_trip, leave_trip,
--    replace_trip_days, an owner's direct delete) removes their activities
--    through the FK's ON DELETE CASCADE, which runs one DELETE per day row —
--    and by the time it runs that day row is already gone. A transition row
--    whose day no longer exists is therefore part of a cascade, and the guard
--    allows it (it only blocks when it can SEE a live day of someone else's
--    trip). Service-role writes (auth.uid() IS NULL) are exempt.
--
-- What the old APK does now, run by a co-member: Home delete fails at the
-- first step (the client ignores the error, its later steps are refused or
-- match 0 rows), so the trip survives intact for everyone; the old IG save /
-- regenerate cannot remove the existing plan nor add a second one (its trip
-- row update — new name / ig_response — still lands; the days stay the old,
-- whole plan). Owners on the old APK are unaffected — it is their trip.
--
-- Rollback (staging first):
--   DROP TRIGGER IF EXISTS activities_bulk_delete_guard ON activities;
--   DROP FUNCTION IF EXISTS public.guard_bulk_activity_delete();
--   -- restore the edit-member days DELETE policy: re-run
--   --   20261028000001_days_delete_policy.sql, then
--   DROP POLICY IF EXISTS "Owner can delete days" ON days;
--   CREATE POLICY "Edit members can insert days" ON days FOR INSERT
--     WITH CHECK (auth.uid() IN (SELECT user_id FROM trip_members
--                 WHERE trip_id = days.trip_id AND role = 'edit'));
--   CREATE POLICY "trip editors can insert days" ON days FOR INSERT
--     TO authenticated WITH CHECK (trip_id IN (SELECT trip_id FROM
--     trip_members WHERE user_id = auth.uid() AND role = 'edit'));
--   DROP POLICY IF EXISTS "Owner can insert days" ON days;
--   ALTER FUNCTION public.replace_trip_days(uuid, jsonb) SECURITY INVOKER;
-- Restoring the policy BEFORE flipping replace_trip_days back to INVOKER
-- matters: an INVOKER replace without an edit-member days DELETE policy
-- deletes 0 rows and raises "could not remove the existing days", i.e.
-- co-members can no longer regenerate.
--
-- Idempotent (safe to re-run) — migrations here are applied by hand. One
-- transaction: applied halfway (owner-only policies, INVOKER replace) would
-- stop co-members regenerating.
-- ============================================================================

BEGIN;

-- 1. days DELETE and INSERT: owner only -----------------------------------------
DROP POLICY IF EXISTS "Edit members can delete days" ON days;
DROP POLICY IF EXISTS "Owner can delete days" ON days;
CREATE POLICY "Owner can delete days" ON days FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = days.trip_id AND t.owner_id = auth.uid()));
DROP POLICY IF EXISTS "Edit members can insert days" ON days;
DROP POLICY IF EXISTS "trip editors can insert days" ON days;
DROP POLICY IF EXISTS "Owner can insert days" ON days;
CREATE POLICY "Owner can insert days" ON days FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM trips t WHERE t.id = days.trip_id AND t.owner_id = auth.uid()));

-- 2. replace_trip_days: SECURITY DEFINER ---------------------------------------
-- Body unchanged from 20261028000002 apart from the header and the delete
-- check's comment. As DEFINER, RLS no longer filters its writes, so:
--   * the edit-membership check below is THE authorization gate — it runs
--     before any write (an owner normally holds an edit row too — the creator's
--     row is inserted with the trip; the rare legacy owner without one could
--     not regenerate before this migration either);
--   * every statement is scoped to p_trip (the day DELETE and INSERT, and the
--     activity INSERT keyed on the day just inserted for p_trip);
--   * auth.uid() still reads the caller's JWT, so added_by stays the caller.
--
-- p_days: array, in display order (position = index), of
--   {label, date, city, description, story_title, narrative, wishlist,
--    hotel_options, hotel_check_in_time, transit_tip, activities:[…]}
-- activity = {time, title, geocode, geocode_end, type, duration, note, gloss,
--             photo_query, confirmed, icon, package, transition_data}
-- An empty array just clears the itinerary. Activities without a title are
-- skipped. Returns the saved days, in position order, each with its
-- "activities" array. Delete and inserts run in ONE transaction.
CREATE OR REPLACE FUNCTION public.replace_trip_days(p_trip uuid, p_days jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  d       jsonb;
  v_pos   int;
  v_day   uuid;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'replace_trip_days: not signed in';
  END IF;
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' THEN
    RAISE EXCEPTION 'replace_trip_days: days must be an array';
  END IF;
  IF jsonb_array_length(p_days) > 90 THEN
    RAISE EXCEPTION 'replace_trip_days: too many days';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_days) x
              WHERE jsonb_typeof(x) <> 'object'
                 OR jsonb_typeof(coalesce(x->'activities', '[]')) <> 'array'
                 OR jsonb_array_length(coalesce(x->'activities', '[]')) > 60)
  THEN
    RAISE EXCEPTION 'replace_trip_days: malformed day';
  END IF;

  -- The gate: nothing below runs for a caller without an edit membership.
  IF NOT EXISTS (SELECT 1 FROM trip_members
                  WHERE trip_id = p_trip AND user_id = v_uid AND role = 'edit')
  THEN
    RAISE EXCEPTION 'replace_trip_days: not allowed to edit this trip';
  END IF;

  -- Serialise against another replace of the same trip (two co-travellers
  -- regenerating at once would otherwise interleave into one doubled plan).
  PERFORM pg_advisory_xact_lock(hashtextextended('replace_trip_days:' || p_trip, 0));

  -- Activities go with their days (ON DELETE CASCADE, one DELETE per day, so
  -- the activities bulk-delete guard lets them through).
  DELETE FROM days WHERE trip_id = p_trip;
  -- Cannot fire as DEFINER (no RLS filtering); kept as a cheap invariant.
  IF EXISTS (SELECT 1 FROM days WHERE trip_id = p_trip) THEN
    RAISE EXCEPTION 'replace_trip_days: could not remove the existing days';
  END IF;

  FOR d, v_pos IN
    SELECT value, (ordinality - 1)::int
      FROM jsonb_array_elements(p_days) WITH ORDINALITY
  LOOP
    INSERT INTO days (trip_id, label, date, city, position, description,
                      story_title, narrative, wishlist, hotel_options,
                      hotel_check_in_time, transit_tip)
    VALUES (p_trip, d->>'label', nullif(d->>'date', '')::date, d->>'city',
            v_pos, nullif(d->>'description', ''),
            nullif(d->>'story_title', ''), nullif(d->>'narrative', ''),
            nullif(d->'wishlist', 'null'::jsonb),
            nullif(d->'hotel_options', 'null'::jsonb),
            nullif(d->>'hotel_check_in_time', ''),
            nullif(d->>'transit_tip', ''))
    RETURNING id INTO v_day;

    INSERT INTO activities (day_id, time, title, geocode, geocode_end, type,
                            duration, note, gloss, photo_query, confirmed,
                            icon, package, position, added_by, transition_data)
    SELECT v_day, a->>'time', a->>'title', nullif(a->>'geocode', ''),
           nullif(a->>'geocode_end', ''), a->>'type', a->>'duration',
           a->>'note', nullif(a->>'gloss', ''), nullif(a->>'photo_query', ''),
           -- Lenient like the old per-row inserts: a stray non-boolean must
           -- not sink the whole itinerary.
           coalesce(CASE jsonb_typeof(a->'confirmed')
                      WHEN 'boolean' THEN (a->>'confirmed')::boolean
                      WHEN 'string' THEN lower(a->>'confirmed') IN ('true', 't', 'yes', '1')
                    END, false),
           a->>'icon',
           nullif(a->>'package', ''),
           (row_number() OVER (ORDER BY n) - 1)::int, v_uid,
           nullif(a->'transition_data', 'null'::jsonb)
      FROM jsonb_array_elements(coalesce(d->'activities', '[]'))
           WITH ORDINALITY AS x(a, n)
     WHERE coalesce(trim(a->>'title'), '') <> '';
  END LOOP;

  SELECT coalesce(jsonb_agg(
           to_jsonb(dy) || jsonb_build_object('activities',
             (SELECT coalesce(jsonb_agg(to_jsonb(ac) ORDER BY ac.position), '[]')
                FROM activities ac WHERE ac.day_id = dy.id))
           ORDER BY dy.position), '[]')
    INTO v_out
    FROM days dy WHERE dy.trip_id = p_trip;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.replace_trip_days(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_trip_days(uuid, jsonb) TO authenticated;

-- 3. activities: refuse multi-day bulk deletes on someone else's trip ----------
-- SECURITY DEFINER so it sees every live day/trip regardless of the caller's
-- RLS. Cost: one pass over the statement's deleted rows; the day/trip lookup
-- (primary keys) only runs when they span more than one day, which no current
-- client path does.
CREATE OR REPLACE FUNCTION public.guard_bulk_activity_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;  -- service role / migrations
  END IF;
  IF (SELECT count(DISTINCT day_id) FROM deleted_activities) <= 1 THEN
    RETURN NULL;  -- one day: chat edits, undo, single removes, FK cascades
  END IF;
  -- Join to LIVE days only: a day already gone means these rows are a
  -- cascade from deleting that day, which is governed by the days policy.
  IF EXISTS (SELECT 1
               FROM (SELECT DISTINCT day_id FROM deleted_activities) o
               JOIN days d ON d.id = o.day_id
               JOIN trips t ON t.id = d.trip_id
              WHERE t.owner_id IS DISTINCT FROM v_uid)
  THEN
    RAISE EXCEPTION 'bulk_activity_delete_owner_only'
      USING ERRCODE = '42501',
            HINT = 'Only the trip owner can delete activities across several days at once.';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.guard_bulk_activity_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activities_bulk_delete_guard ON activities;
CREATE TRIGGER activities_bulk_delete_guard
  AFTER DELETE ON activities
  REFERENCING OLD TABLE AS deleted_activities
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.guard_bulk_activity_delete();

COMMIT;

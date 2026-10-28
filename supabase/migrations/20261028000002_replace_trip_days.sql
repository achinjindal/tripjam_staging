-- ============================================================================
-- replace_trip_days(p_trip uuid, p_days jsonb) — swap a trip's itinerary atomically
-- ============================================================================
-- Saving a generated itinerary used to be one request per day and one per
-- activity, after a separate delete of the old days. Any failure part-way left
-- a half-saved trip: old days gone and only some new ones in, or (for an
-- activity) a day silently missing a stop. This does the delete and every
-- insert in ONE transaction: either the whole new itinerary lands or the old
-- one is untouched.
--
-- SECURITY INVOKER: runs as the calling user, so the days and activities RLS
-- policies apply to every write. The caller must be an edit member (owners
-- always are): that is what the inserts need anyway, and it lets the caller
-- SEE every day of the trip — RLS filters a DELETE silently, so the function
-- checks afterwards that the old days are really gone, and that check is only
-- sound for a caller who can read them.
--
-- p_days: array, in display order (position = index), of
--   {label, date, city, description, story_title, narrative, wishlist,
--    hotel_options, hotel_check_in_time, transit_tip, activities:[…]}
-- activity = {time, title, geocode, geocode_end, type, duration, note, gloss,
--             photo_query, confirmed, icon, package, transition_data}
-- An empty array just clears the itinerary. Activities without a title are
-- skipped (the per-row inserts this replaces dropped them the same way).
--
-- Returns the saved days, in position order, each with its "activities"
-- array — the same rows the browser used to read back from its inserts.
--
-- Idempotent (safe to re-run) — migrations here are applied by hand.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.replace_trip_days(p_trip uuid, p_days jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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

  IF NOT EXISTS (SELECT 1 FROM trip_members
                  WHERE trip_id = p_trip AND user_id = v_uid AND role = 'edit')
  THEN
    RAISE EXCEPTION 'replace_trip_days: not allowed to edit this trip';
  END IF;

  -- Serialise against another replace of the same trip (two co-travellers
  -- regenerating at once would otherwise interleave into one doubled plan).
  PERFORM pg_advisory_xact_lock(hashtextextended('replace_trip_days:' || p_trip, 0));

  -- Activities go with their days (ON DELETE CASCADE).
  DELETE FROM days WHERE trip_id = p_trip;
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

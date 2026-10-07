-- ============================================================================
-- apply_activity_ops(p_ops jsonb) — apply Trippy's itinerary edits atomically
-- ============================================================================
-- Chat used to rewrite a whole day (delete every activity, re-insert the
-- model's version). Chat v3 has the model return small operations against
-- specific activities instead; the chat function resolves the model's short
-- refs ("D3.2") to real ids and the browser applies them here, in ONE
-- transaction: either every operation lands or none does.
--
-- SECURITY INVOKER: runs as the calling user, so the activities RLS policies
-- (edit members only) apply to every write. A write RLS silently filters out
-- shows up as "not found" and aborts the whole batch.
--
-- p_ops: array, applied in order, of
--   {"op":"remove",   "activity_id"}
--   {"op":"replace",  "activity_id", "activity":{…}}      new place, same slot
--   {"op":"insert",   "day_id", "after_id"|null, "activity":{…}}
--   {"op":"move",     "activity_id", "day_id", "after_id"|null}
--   {"op":"set_time", "activity_id", "time"}
-- activity = {time, title, geocode, geocode_end, type, duration, note, icon}
-- after_id null = start of the day. Several inserts after the same anchor land
-- in the order given.
--
-- Returns {"before":[{day_id, activities:[…]}], "after":[…]} for every day
-- touched: "before" is the undo snapshot (restoreDayActivities in
-- src/feed.js), "after" is what the browser renders.
--
-- Idempotent (safe to re-run) — migrations here are applied by hand.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_activity_ops(p_ops jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  op        jsonb;
  v_kind    text;
  v_act     uuid;
  v_day     uuid;
  v_after   uuid;
  v_pos     int;
  v_old_day uuid;
  v_old_pos int;
  v_new     uuid;
  v_key     text;
  v_days    uuid[];
  v_before  jsonb;
  v_after_j jsonb;
  -- anchor key ("<after_id>" or "start:<day_id>") → last row placed there,
  -- so consecutive inserts after one anchor keep their order.
  v_anchor  jsonb := '{}'::jsonb;
  a         jsonb;
BEGIN
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array'
     OR jsonb_array_length(p_ops) = 0 THEN
    RAISE EXCEPTION 'apply_activity_ops: no operations';
  END IF;
  IF jsonb_array_length(p_ops) > 60 THEN
    RAISE EXCEPTION 'apply_activity_ops: too many operations';
  END IF;

  -- Every day the batch touches: target days, plus the days of the
  -- activities it names.
  SELECT array_agg(DISTINCT d) INTO v_days
  FROM (
    SELECT nullif(o->>'day_id', '')::uuid AS d
      FROM jsonb_array_elements(p_ops) o
    UNION
    SELECT x.day_id
      FROM activities x
      JOIN jsonb_array_elements(p_ops) o
        ON x.id = nullif(o->>'activity_id', '')::uuid
  ) s
  WHERE d IS NOT NULL;
  IF v_days IS NULL THEN
    RAISE EXCEPTION 'apply_activity_ops: no visible day or activity';
  END IF;

  -- Serialise against other edits of the same days.
  PERFORM 1 FROM activities WHERE day_id = ANY (v_days) FOR UPDATE;

  -- Undo snapshot, before anything changes.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day_id', d,
           'activities', (SELECT coalesce(jsonb_agg(to_jsonb(x)
                                   ORDER BY x.position NULLS LAST, x.id), '[]')
                            FROM activities x WHERE x.day_id = d))), '[]')
    INTO v_before
    FROM unnest(v_days) d;

  -- Positions in existing data can have gaps or ties. Renumber 0..n-1 in
  -- display order so the relative shifts below are exact.
  UPDATE activities x
     SET position = r.rn - 1
    FROM (SELECT id, row_number() OVER (
                 PARTITION BY day_id ORDER BY position NULLS LAST, id) AS rn
            FROM activities WHERE day_id = ANY (v_days)) r
   WHERE x.id = r.id AND x.position IS DISTINCT FROM r.rn - 1;

  FOR op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    v_kind := op->>'op';
    v_act := nullif(op->>'activity_id', '')::uuid;
    v_day := nullif(op->>'day_id', '')::uuid;
    a := op->'activity';

    IF v_kind IN ('remove', 'replace', 'move') THEN
      -- Take the activity out of its slot (all three start this way).
      DELETE FROM activities WHERE id = v_act AND v_kind <> 'move'
        RETURNING day_id, position INTO v_old_day, v_old_pos;
      IF v_kind = 'move' THEN
        SELECT day_id, position INTO v_old_day, v_old_pos
          FROM activities WHERE id = v_act;
      END IF;
      IF v_old_day IS NULL THEN
        RAISE EXCEPTION 'apply_activity_ops: % — activity % not found',
          v_kind, v_act;
      END IF;
    END IF;

    IF v_kind = 'remove' THEN
      UPDATE activities SET position = position - 1
       WHERE day_id = v_old_day AND position > v_old_pos;

    ELSIF v_kind = 'replace' THEN
      -- A different place in the same slot: a new row, so the old place's
      -- coordinates, verification, photo, booking and flags (cascade) go.
      IF coalesce(trim(a->>'title'), '') = '' THEN
        RAISE EXCEPTION 'apply_activity_ops: replace without a title';
      END IF;
      INSERT INTO activities (day_id, time, title, geocode, geocode_end, type,
                              duration, note, icon, confirmed, position,
                              added_by)
      VALUES (v_old_day, nullif(a->>'time', ''), a->>'title',
              nullif(a->>'geocode', ''), nullif(a->>'geocode_end', ''),
              nullif(a->>'type', ''), nullif(a->>'duration', ''),
              nullif(a->>'note', ''), nullif(a->>'icon', ''), false,
              v_old_pos, auth.uid())
      RETURNING id INTO v_new;
      v_anchor := v_anchor || jsonb_build_object(v_act::text, v_new);

    ELSIF v_kind IN ('insert', 'move') THEN
      IF v_day IS NULL THEN
        RAISE EXCEPTION 'apply_activity_ops: % without a day', v_kind;
      END IF;
      IF v_kind = 'move' THEN
        UPDATE activities SET position = position - 1
         WHERE day_id = v_old_day AND position > v_old_pos;
      END IF;
      v_key := coalesce(nullif(op->>'after_id', ''), 'start:' || v_day);
      v_after := coalesce(nullif(v_anchor->>v_key, '')::uuid,
                          nullif(op->>'after_id', '')::uuid);
      IF v_after IS NULL THEN
        v_pos := 0;
      ELSE
        SELECT position + 1 INTO v_pos
          FROM activities WHERE id = v_after AND day_id = v_day;
        IF v_pos IS NULL THEN
          RAISE EXCEPTION 'apply_activity_ops: % — anchor % is not on day %',
            v_kind, v_after, v_day;
        END IF;
      END IF;
      UPDATE activities SET position = position + 1
       WHERE day_id = v_day AND position >= v_pos
         AND id IS DISTINCT FROM v_act;
      IF v_kind = 'insert' THEN
        IF coalesce(trim(a->>'title'), '') = '' THEN
          RAISE EXCEPTION 'apply_activity_ops: insert without a title';
        END IF;
        INSERT INTO activities (day_id, time, title, geocode, geocode_end,
                                type, duration, note, icon, confirmed,
                                position, added_by)
        VALUES (v_day, nullif(a->>'time', ''), a->>'title',
                nullif(a->>'geocode', ''), nullif(a->>'geocode_end', ''),
                nullif(a->>'type', ''), nullif(a->>'duration', ''),
                nullif(a->>'note', ''), nullif(a->>'icon', ''), false,
                v_pos, auth.uid())
        RETURNING id INTO v_new;
      ELSE
        UPDATE activities SET day_id = v_day, position = v_pos
         WHERE id = v_act
        RETURNING id INTO v_new;
        IF v_new IS NULL THEN
          RAISE EXCEPTION 'apply_activity_ops: move — activity % not updated',
            v_act;
        END IF;
      END IF;
      v_anchor := v_anchor || jsonb_build_object(v_key, v_new);

    ELSIF v_kind = 'set_time' THEN
      UPDATE activities SET time = nullif(op->>'time', '')
       WHERE id = v_act
      RETURNING id INTO v_new;
      IF v_new IS NULL THEN
        RAISE EXCEPTION 'apply_activity_ops: set_time — activity % not found',
          v_act;
      END IF;

    ELSE
      RAISE EXCEPTION 'apply_activity_ops: unknown op %', v_kind;
    END IF;

    v_old_day := NULL;
    v_old_pos := NULL;
    v_new := NULL;
  END LOOP;

  -- A row's transit hint describes the leg to the NEXT activity. Clear it on
  -- every row whose next activity changed; keep the rest.
  WITH old AS (
    SELECT (e->>'id')::uuid AS id,
           lead((e->>'id')::uuid) OVER (
             PARTITION BY d->>'day_id'
             ORDER BY (e->>'position')::int NULLS LAST, e->>'id') AS nxt
      FROM jsonb_array_elements(v_before) d,
           jsonb_array_elements(d->'activities') e
  ), cur AS (
    SELECT id, lead(id) OVER (PARTITION BY day_id ORDER BY position, id) AS nxt
      FROM activities WHERE day_id = ANY (v_days)
  )
  UPDATE activities x
     SET transition_data = NULL, transition_mins = NULL, transition_mode = NULL
    FROM cur LEFT JOIN old ON old.id = cur.id
   WHERE x.id = cur.id
     AND (old.id IS NULL OR old.nxt IS DISTINCT FROM cur.nxt)
     AND (x.transition_data IS NOT NULL OR x.transition_mins IS NOT NULL
          OR x.transition_mode IS NOT NULL);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day_id', d,
           'activities', (SELECT coalesce(jsonb_agg(to_jsonb(x)
                                   ORDER BY x.position, x.id), '[]')
                            FROM activities x WHERE x.day_id = d))), '[]')
    INTO v_after_j
    FROM unnest(v_days) d;

  RETURN jsonb_build_object('before', v_before, 'after', v_after_j);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_activity_ops(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_activity_ops(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_activity_ops(jsonb) TO authenticated;

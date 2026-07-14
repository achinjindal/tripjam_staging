-- Share links: close the enumeration hole.
--
-- The old anon policies granted SELECT on every trip where share_token IS NOT
-- NULL (plus all its days/activities, all columns) — the token check happened
-- only client-side, so any anonymous client could enumerate every shared trip.
--
-- Replace them with a SECURITY DEFINER RPC that requires the exact token and
-- returns only the columns the public view renders.

DROP POLICY IF EXISTS "Public read trips by share token" ON trips;
DROP POLICY IF EXISTS "Public read days by share token" ON days;
DROP POLICY IF EXISTS "Public read activities by share token" ON activities;

CREATE OR REPLACE FUNCTION public.get_shared_trip(p_token uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'trip', jsonb_build_object(
      'name', t.name,
      'destination', t.destination,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'summary', t.summary
    ),
    'days', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'label', d.label,
          'city', d.city,
          'date', d.date,
          'activities', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'icon', a.icon,
                'time', a."time",
                'title', a.title,
                'note', a.note,
                'duration', a.duration,
                'photo_url', a.photo_url
              )
              ORDER BY a."position"
            )
            FROM activities a
            WHERE a.day_id = d.id
          ), '[]'::jsonb)
        )
        ORDER BY d."position"
      )
      FROM days d
      WHERE d.trip_id = t.id
    ), '[]'::jsonb)
  )
  FROM trips t
  WHERE t.share_token = p_token;
$$;

REVOKE ALL ON FUNCTION public.get_shared_trip(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_trip(uuid) TO anon, authenticated;

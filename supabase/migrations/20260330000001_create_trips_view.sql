CREATE OR REPLACE VIEW trips_with_creator AS
SELECT
  t.*,
  p.username                                                          AS created_by_username,
  p.face_icon                                                         AS created_by_face_icon,
  EXTRACT(EPOCH FROM (t.generation_completed_at - t.generation_started_at))::int AS ig_seconds
FROM trips t
LEFT JOIN profiles p ON p.id = t.created_by;
